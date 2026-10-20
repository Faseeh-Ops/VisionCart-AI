import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';

// Separate test entry avoids sharing database cleanup hooks with workflows.spec.js.
export default defineConfig({
  ...base,
  testMatch:'dataset-application.e2e.js',
  reporter:[['line'],['html',{outputFolder:'playwright-report/dataset-application',open:'never'}]],
  use:{...base.use,headless:false,trace:'retain-on-failure',screenshot:'only-on-failure'},
});
