/**
 * RUSH Car Wash - Unifonic SMS Integration
 * Dispatches verification SMS OTPs to customer mobile numbers.
 */

const UNIFONIC_APP_ID = process.env.UNIFONIC_APP_ID || "Yo2Ui5FSzyM6BJ56YmOXVpGmqstcjk";
const UNIFONIC_SENDER_ID = process.env.UNIFONIC_SENDER_ID || "RushWash";
const UNIFONIC_BASE_URL = process.env.UNIFONIC_BASE_URL || "https://el.cloud.unifonic.com";

export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  if (!UNIFONIC_APP_ID) {
    console.warn("[Unifonic] UNIFONIC_APP_ID missing; skipping SMS dispatch.");
    return false;
  }

  // Format phone to 9665xxxxxxxx
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("05") && digits.length === 10) {
    digits = "966" + digits.slice(1);
  } else if (digits.startsWith("5") && digits.length === 9) {
    digits = "966" + digits;
  }

  const message = `رمز التحقق الخاص بك في رش واش: ${code}\nYour Rush Wash verification code is: ${code}`;

  try {
    const endpoint = `${UNIFONIC_BASE_URL.replace(/\/+$/, "")}/rest/Messages/SendBulk`;
    const params = new URLSearchParams({
      AppSid: UNIFONIC_APP_ID,
      SenderID: UNIFONIC_SENDER_ID,
      Body: message,
      Recipient: digits,
      responseType: "json",
    });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: params.toString(),
    });

    const data: any = await res.json().catch(() => null);
    const success = res.ok && String(data?.success).toLowerCase() === "true";
    if (success) {
      console.log(`[Unifonic] Successfully dispatched OTP SMS to ${digits}`);
    } else {
      console.warn(`[Unifonic] SMS dispatch response:`, res.status, data);
    }
    return success;
  } catch (err: any) {
    console.error(`[Unifonic] Error sending OTP SMS to ${digits}:`, err?.message || err);
    return false;
  }
}
