export function describeUserAgent(userAgent: string | null) {
  const ua = userAgent || "";

  let browser = "Unknown browser";
  if (/Edg\/([\d.]+)/i.test(ua)) browser = "Microsoft Edge";
  else if (/OPR\/([\d.]+)/i.test(ua)) browser = "Opera";
  else if (/CriOS\/([\d.]+)/i.test(ua)) browser = "Google Chrome";
  else if (/Chrome\/([\d.]+)/i.test(ua)) browser = "Google Chrome";
  else if (/FxiOS\/([\d.]+)/i.test(ua)) browser = "Mozilla Firefox";
  else if (/Firefox\/([\d.]+)/i.test(ua)) browser = "Mozilla Firefox";
  else if (/Version\/([\d.]+).*Safari/i.test(ua)) browser = "Safari";

  let operatingSystem = "Unknown OS";
  if (/Windows NT/i.test(ua)) operatingSystem = "Windows";
  else if (/Android/i.test(ua)) operatingSystem = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) operatingSystem = "iOS / iPadOS";
  else if (/Mac OS X/i.test(ua)) operatingSystem = "macOS";
  else if (/CrOS/i.test(ua)) operatingSystem = "ChromeOS";
  else if (/Linux/i.test(ua)) operatingSystem = "Linux";

  let device = "Computer";
  if (/iPad|Tablet/i.test(ua)) device = "Tablet";
  else if (/Mobile|iPhone|iPod|Android/i.test(ua)) device = "Mobile";

  return { browser, operatingSystem, device };
}
