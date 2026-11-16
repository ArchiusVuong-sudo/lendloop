import { clerk } from "@clerk/testing/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { clerkIds, convexRun, USERS, type TestUser } from "./helpers";

const RUN = Date.now().toString(36);
const TOOL = `E2E ladder ${RUN}`;

function localDay(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

async function signedInPage(browser: Browser, user: TestUser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await clerk.signIn({ page, signInParams: { strategy: "email_code", identifier: user.email } });
  await page.goto("/tools");
  await expect(page.getByTestId("viewer-name")).toContainText(user.firstName);
  return page;
}

const card = (page: Page, testId: string) => page.getByTestId(testId).filter({ hasText: TOOL });

test.describe.serial("LendLoop smoke: public list, sign-in, list, request, approve, return", () => {
  let lender: Page;
  let borrower: Page;

  test.afterAll(async () => {
    await lender?.context().close();
    await borrower?.context().close();
  });

  test("public page is read-only and the sign-in button goes to Clerk", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Borrow what you need. Lend what you don't." })).toBeVisible();
    await page.getByRole("button", { name: "Sign in to lend or borrow" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText(/sign in to/i).first()).toBeVisible();
  });

  test("signed-out visitors cannot open the app pages", async ({ page }) => {
    await page.goto("/incoming");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("lender signs in with a Clerk test user and lists a tool", async ({ browser }) => {
    lender = await signedInPage(browser, USERS.lender);
    await lender.goto("/listings");
    await lender.getByRole("button", { name: "List a tool" }).click();
    await lender.getByLabel("Name").fill(TOOL);
    await lender.getByLabel("Category").selectOption("hand_tools");
    await lender.getByLabel("Condition").selectOption("good");
    await lender.getByLabel("Short description").fill("Aluminium, 3 m. Pick up after 6pm.");
    await lender.getByRole("button", { name: "Publish listing" }).click();
    await expect(card(lender, "listing-card")).toContainText("Available");
  });

  test("the public list shows the tool by name and category only", async ({ page }) => {
    await page.goto("/");
    const row = page.getByTestId("public-tool").filter({ hasText: TOOL });
    await expect(row).toHaveText(`${TOOL}Hand tools`);
    await expect(page.getByText(USERS.lender.firstName, { exact: false })).toHaveCount(0);
  });

  test("borrower filters by category and requests a date range", async ({ browser }) => {
    borrower = await signedInPage(browser, USERS.borrower);
    await borrower.getByLabel("Filter by category").selectOption("hand_tools");
    const tool = card(borrower, "tool-card");
    await expect(tool).toContainText(`Lent by ${USERS.lender.firstName}`);
    await tool.getByRole("button", { name: "Request to borrow" }).click();
    await tool.getByLabel("From").fill(localDay(0));
    await tool.getByLabel("Until").fill(localDay(2));
    await tool.getByRole("button", { name: "Send request" }).click();
    await expect(tool).toContainText("Request pending");

    await borrower.goto("/requests");
    await expect(card(borrower, "request-card")).toContainText("pending");
  });

  test("lender approves; n8n notifies and writes the activity back", async () => {
    await lender.goto("/incoming");
    const request = card(lender, "request-card");
    await expect(request).toContainText(`by ${USERS.borrower.firstName}`);
    // The notification for the new request went Convex -> n8n -> Convex.
    await expect(request).toContainText("Owner notified of the request", { timeout: 30_000 });
    await request.getByRole("button", { name: "Approve" }).click();
    await expect(request).toContainText("on loan");
    await expect(request).toContainText("Borrower notified: approved", { timeout: 30_000 });

    const publicPage = await lender.context().browser()!.newPage();
    await publicPage.goto("/");
    await expect(publicPage.getByTestId("public-tools").or(publicPage.getByText("No tools listed yet"))).toBeVisible();
    await expect(publicPage.getByTestId("public-tool").filter({ hasText: TOOL })).toHaveCount(0);
    await publicPage.close();
  });

  test("lender marks it returned and the borrower sees it", async () => {
    const request = card(lender, "request-card");
    await request.getByRole("button", { name: "Mark returned" }).click();
    await expect(request).toContainText("returned");

    await borrower.goto("/requests");
    const mine = card(borrower, "request-card");
    await expect(mine).toContainText("returned");
    await expect(mine).toContainText("Borrower notified: marked returned", { timeout: 30_000 });
  });

  test("a normal user does not get the admin page", async () => {
    await borrower.goto("/admin");
    await expect(borrower.getByText("This page is for admins.")).toBeVisible();
  });

  test("admin marks a Trusted Lender and removes the listing", async ({ browser }) => {
    const admin = await signedInPage(browser, USERS.admin);
    // Roles are only granted from the Convex CLI, never from the app.
    convexRun("users:setRole", { clerkUserId: clerkIds().admin, role: "admin" });
    await admin.goto("/admin");
    await expect(admin.getByRole("heading", { name: "Admin" })).toBeVisible();
    await expect(card(admin, "request-card")).toContainText("returned");

    const row = admin.getByTestId("lender-row").filter({ hasText: USERS.lender.firstName });
    const unmark = row.getByRole("button", { name: "Remove Trusted Lender" });
    if (await unmark.isVisible()) await unmark.click();
    await row.getByRole("button", { name: "Mark as Trusted Lender" }).click();
    await expect(row).toContainText("Trusted Lender");

    await admin.goto("/tools");
    const tool = card(admin, "tool-card");
    await expect(tool).toContainText("Trusted Lender");
    admin.once("dialog", (dialog) => dialog.accept());
    await tool.getByRole("button", { name: "Remove listing" }).click();
    await expect(tool).toHaveCount(0);
    await admin.context().close();
  });
});
