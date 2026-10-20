import {defineConfig} from '@playwright/test';
import base from './playwright.config.js';
export default defineConfig({
 ...base,testMatch:'ai-billing.e2e.js',timeout:180000,
 reporter:[['line'],['html',{outputFolder:'playwright-report/ai-application',open:'never'}]],
 use:{...base.use,headless:false,trace:'retain-on-failure',screenshot:'only-on-failure'},
});
