import { Router } from "express";

// Paystack redirects here after checkout. It deliberately doesn't claim success: the chat confirms that.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Payment received</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #1b1f24; margin: 0; padding: 16px; }
  main { max-width: 420px; margin: 15vh auto; background: #fff; border-radius: 12px; padding: 28px 24px; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 1.3rem; margin: 0 0 12px; }
  p { line-height: 1.5; margin: 0 0 10px; }
  small { color: #667; }
</style>
</head>
<body>
<main>
  <h1>Thanks, we've received your payment details</h1>
  <p>You can close this page and return to WhatsApp. We'll confirm in the chat as soon as your application fee comes through.</p>
  <small>Prototype for demonstration only, using Paystack test mode. Not affiliated with Nexford University.</small>
</main>
</body>
</html>`;

export function paymentCallbackRouter(): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.type("html").send(PAGE);
  });
  return router;
}
