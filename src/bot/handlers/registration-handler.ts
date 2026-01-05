/**
 * RegistrationHandler - Handles registration form filling and submission
 */

/* eslint-disable no-var */
declare var document: any
/* eslint-enable no-var */

import type { Page } from "puppeteer-core"
import { delay } from "../../utils/helpers"
import { logger } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"

export class RegistrationHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private currentEmail: string
  private config: any

  constructor(page: Page, proxyManager: ProxyManager | null, currentEmail: string, config: any) {
    this.page = page
    this.proxyManager = proxyManager
    this.currentEmail = currentEmail
    this.config = config
  }

  private getProxyAwareTimeout(baseTimeout: number): number {
    if (this.proxyManager?.getCurrentProxy()) {
      return baseTimeout * 2
    }
    return baseTimeout
  }

  private async proxyAwareDelay(baseDelay: number): Promise<void> {
    const adjustedDelay = this.proxyManager?.getCurrentProxy() ? baseDelay * 1.5 : baseDelay
    await delay(adjustedDelay)
  }

  async findAndClickLoginButton(): Promise<boolean> {
    const loginButtonTimeout = this.getProxyAwareTimeout(this.config.elementWaitTimeout)
    let loginButtonFound = false
    let retryCount = 0
    const maxRetries = 3

    while (!loginButtonFound && retryCount < maxRetries) {
      try {
        await this.page.waitForSelector('#pop2LoginBtn, .pop_btn3, [data-lang="lang24"]', {
          timeout: loginButtonTimeout / maxRetries,
        })
        loginButtonFound = true
        logger.success("Login button found on page")
      } catch (error) {
        retryCount++
        if (retryCount < maxRetries) {
          logger.warn(`Login button not found (attempt ${retryCount}/${maxRetries}), retrying...`)
          const retryDelay = this.proxyManager?.getCurrentProxy() ? 5000 : 2000
          await delay(retryDelay * retryCount)
        } else {
          logger.error("Login button not found after all retries")
          throw error
        }
      }
    }

    return loginButtonFound
  }

  async fillEmailInput(): Promise<boolean> {
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="mail" i]',
    ]

    for (const selector of emailSelectors) {
      try {
        const element = await this.page.$(selector)
        if (element) {
          logger.info(`Found email input: ${selector}`)
          await element.type(this.currentEmail, { delay: 100 })
          return true
        }
      } catch (e) {
        continue
      }
    }

    logger.warn("Email input not found, checking for other login methods...")
    const loginButtons = await this.page.$$('button, a, [role="button"]')
    logger.info(`Found ${loginButtons.length} potential buttons/links`)
    await this.page.screenshot({ path: "debug-screenshot.png", fullPage: true })
    return false
  }

  async fillPasswordInput(): Promise<boolean> {
    const loginPasswordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="password" i]',
      'input[placeholder*="pass" i]',
    ]

    for (const selector of loginPasswordSelectors) {
      try {
        const element = await this.page.$(selector)
        if (element) {
          logger.info(`Found password input: ${selector}`)
          await element.type(this.config.levelinfPassword, { delay: 100 })
          return true
        }
      } catch (e) {
        continue
      }
    }
    return false
  }

  async clickSubmitButton(): Promise<boolean> {
    const submitSelectors = [
      "#pop2LoginBtn",
      'a.pop_btn3.btnA[id="pop2LoginBtn"]',
      'button[type="submit"]',
      'button:contains("Login")',
      'button:contains("Register")',
      'button:contains("Sign")',
      'input[type="submit"]',
      ".login-btn",
      ".register-btn",
      ".submit-btn",
      'a[href="javascript:;"][class*="btn"]',
    ]

    for (const selector of submitSelectors) {
      try {
        const element = await this.page.$(selector)
        if (element) {
          logger.success(`Found login button: ${selector}`)
          await element.click()
          logger.info("Login button clicked, waiting for registration form...")
          await this.proxyAwareDelay(1000)

          try {
            await this.page.screenshot({ path: "after-login-click.png", fullPage: true })
          } catch (e) {
            logger.warn("Could not save screenshot after login click")
          }

          return true
        }
      } catch (e) {
        continue
      }
    }

    logger.warn("Login button not found automatically, waiting for manual interaction...")
    return false
  }

  async clickRegisterForFreeButton(): Promise<boolean> {
    const registerSelectors = [
      ".login-goRegister__button",
      "button.login-goRegister__button",
      'button:contains("Register for free")',
      'button:contains("Register")',
      '[class*="goRegister"]',
    ]

    for (const selector of registerSelectors) {
      try {
        const element = await this.page.$(selector)
        if (element) {
          logger.success(`Found register button: ${selector}`)
          await element.click()
          logger.info("Register for free button clicked!")
          return true
        }
      } catch (e) {
        continue
      }
    }

    logger.warn("Register button not found, taking screenshot for debugging...")
    await this.page.screenshot({ path: "register-form-debug.png", fullPage: true })
    return false
  }

  async waitForRegistrationForm(): Promise<boolean> {
    let formReady = false
    let formWaitAttempts = 0
    const maxFormWaitAttempts = 5

    while (!formReady && formWaitAttempts < maxFormWaitAttempts) {
      try {
        const emailInput = await this.page.$("#registerForm_account")

        if (emailInput) {
          logger.success("Registration form loaded successfully - found email input")
          formReady = true
        } else {
          formWaitAttempts++
          logger.info(
            `Registration form not ready (attempt ${formWaitAttempts}/${maxFormWaitAttempts}), waiting longer...`,
          )

          if (formWaitAttempts < maxFormWaitAttempts) {
            await this.proxyAwareDelay(2000 + formWaitAttempts * 1000)
          }
        }
      } catch (error) {
        formWaitAttempts++
        logger.info(
          `Registration form not ready (attempt ${formWaitAttempts}/${maxFormWaitAttempts}), waiting longer...`,
        )

        if (formWaitAttempts < maxFormWaitAttempts) {
          await this.proxyAwareDelay(2000 + formWaitAttempts * 1000)
        }
      }
    }

    if (!formReady) {
      logger.error("Registration form failed to load after all attempts")
      try {
        await this.page.screenshot({ path: "registration-form-failed.png", fullPage: true })
      } catch (e) {
        logger.warn("Could not save screenshot")
      }
    }

    return formReady
  }

  async fillRegistrationEmail(): Promise<boolean> {
    logger.info("Filling email address...")
    await this.page.waitForSelector("#registerForm_account", { timeout: 5000 })

    await this.page.evaluate(() => {
      const emailInput = document.getElementById("registerForm_account") as any
      if (emailInput) {
        emailInput.value = ""
        emailInput.focus()
      }
    })

    await this.page.keyboard.type(this.currentEmail, { delay: 120 })

    const filledEmail = await this.page.$eval("#registerForm_account", (el) => (el as any).value)
    if (filledEmail === this.currentEmail) {
      logger.success("Email address filled successfully")
      return true
    } else {
      logger.warn(`Email filling may have failed - expected: ${this.currentEmail}, got: ${filledEmail}`)
      await this.page.evaluate((email) => {
        const emailInput = document.getElementById("registerForm_account") as any
        if (emailInput) {
          emailInput.value = email
          emailInput.dispatchEvent(new Event("input", { bubbles: true }))
          emailInput.dispatchEvent(new Event("change", { bubbles: true }))
        }
      }, this.currentEmail)
      return true
    }
  }

  async clickRegistrationSubmit(): Promise<boolean> {
    const registerSubmitSelectors = [
      'button[type="submit"]',
      'button:contains("Register")',
      'button:contains("Sign up")',
      'button:contains("Create")',
      ".infinite-btn-primary",
      'form button[type="submit"]',
    ]

    for (const selector of registerSubmitSelectors) {
      try {
        const element = await this.page.$(selector)
        if (element) {
          logger.success(`Found registration submit button: ${selector}`)
          await element.click()
          logger.info("Registration form submitted!")
          await this.proxyAwareDelay(1500)
          await this.proxyAwareDelay(3000)
          return true
        }
      } catch (e) {
        continue
      }
    }
    return false
  }
}

export default RegistrationHandler
