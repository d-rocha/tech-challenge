import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { loadState } from './e2e/owned-stack.mjs';

const state = loadState();
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  outputDir: join(state.output, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: join(state.output, 'results.json') }],
    ['html', { outputFolder: join(state.output, 'report'), open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:4200',
    browserName: 'chromium',
    proxy: { server: state.proxy },
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--proxy-bypass-list=<-loopback>'],
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
