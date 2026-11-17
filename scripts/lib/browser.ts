import { chromium, type Browser } from 'playwright';

/**
 * Launch Chromium. Falls back to locally installed Chrome / Edge
 * if `npx playwright install chromium` has not been run.
 */
export async function launchBrowser(): Promise<Browser> {
  const attempts: { label: string; channel?: string }[] = [
    { label: 'playwright chromium' },
    { label: 'chrome', channel: 'chrome' },
    { label: 'msedge', channel: 'msedge' },
  ];
  const errors: string[] = [];
  for (const a of attempts) {
    try {
      return await chromium.launch({ channel: a.channel, headless: true });
    } catch (e) {
      errors.push(`${a.label}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'Не удалось запустить браузер. Выполните `npx playwright install chromium`.\n' +
      errors.join('\n'),
  );
}

export const DESKTOP = { width: 1440, height: 900 };
export const MOBILE = { width: 390, height: 844 };
export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
