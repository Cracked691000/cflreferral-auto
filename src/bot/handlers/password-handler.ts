/**
 * PasswordHandler - Handles password creation page interactions
 */

import type { Page } from "puppeteer-core"
import { delay } from "../../utils/helpers"
import { logger } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"

/* eslint-disable no-var */
declare var document: any
/* eslint-enable no-var */

export class PasswordHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private config: any

  constructor(page: Page, proxyManager: ProxyManager | null, config: any) {
    this.page = page
    this.proxyManager = proxyManager
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

  async clickContinueButton(): Promise<boolean> {
    logger.info("STEP 5: Proceeding to password creation page...")

    const wasUsingStableMode = this.config.useProxy === 5
    if (wasUsingStableMode) {
      logger.info("STABLE MODE: Temporarily disabling proxy for form transition")
      this.proxyManager?.stopKeepAlive?.()
      this.config.useProxy = 0
    }

    const continueSelectors = [
      'button:contains("Continue")',
      'button[type="submit"]',
      ".infinite-btn-primary:not([disabled])",
      'button:not([disabled]):contains("Continue")',
    ]

    let continueClicked = false
    for (const selector of continueSelectors) {
      try {
        const button = await this.page.$(selector)
        if (button) {
          const isDisabled = await this.page.evaluate(
            (el) => (el as any).disabled || (el as any).hasAttribute("disabled"),
            button,
          )
          if (!isDisabled) {
            await button.click()
            logger.success(`Continue button clicked: ${selector}`)
            continueClicked = true
            break
          }
        }
      } catch (e) {
        logger.warn(`Could not check continue button: ${selector}`)
        continue
      }
    }

    if (!continueClicked) {
      logger.info("Continue button not found or disabled, waiting for manual verification code input...")
      logger.info("Please manually enter the verification code sent to your email")
      await delay(10000)
    }

    await delay(2000)

    // Try verification continue button
    const verificationContinueSelectors = [
      "button.infinite-btn-primary.infinite-btn-block",
      'button[type="button"].infinite-btn-primary',
      "button.infinite-btn-primary:not([disabled])",
      'button[type="submit"]:not([disabled])',
    ]

    let verificationContinueClicked = false

    for (const selector of verificationContinueSelectors) {
      try {
        const button = await this.page.$(selector)
        if (button) {
          const isDisabled = await this.page.evaluate(
            (el) => (el as any).disabled || (el as any).hasAttribute("disabled"),
            button,
          )
          const buttonText = await this.page.evaluate((el) => (el as any).textContent?.trim(), button)

          logger.debug(`Checking Continue button: ${selector} - Text: "${buttonText}" - Disabled: ${isDisabled}`)

          if (!isDisabled && buttonText?.includes("Continue")) {
            const randomClickDelay = Math.floor(Math.random() * 1000) + 500
            await delay(randomClickDelay)

            try {
              await button.click()
              logger.success(`Continue button clicked (method 1): ${selector}`)
              verificationContinueClicked = true
              break
            } catch (e1) {
              logger.warn("Method 1 failed, trying method 2...")
              try {
                await delay(500)
                await this.page.evaluate((btn) => (btn as any).click(), button)
                logger.success(`Continue button clicked (method 2 - JS): ${selector}`)
                verificationContinueClicked = true
                break
              } catch (e2) {
                logger.warn("Method 2 failed, trying method 3...")
                try {
                  const box = await button.boundingBox()
                  if (box) {
                    for (let attempt = 0; attempt < 3; attempt++) {
                      const offsetX = (Math.random() - 0.5) * 20
                      const offsetY = (Math.random() - 0.5) * 10
                      await this.page.mouse.click(box.x + box.width / 2 + offsetX, box.y + box.height / 2 + offsetY)
                      await delay(300)
                    }
                    logger.success(`Continue button clicked (method 3 - mouse with retries): ${selector}`)
                    verificationContinueClicked = true
                    break
                  }
                } catch (e3) {
                  logger.error(`All Continue button click methods failed for: ${selector}`)
                }
              }
            }

            if (verificationContinueClicked) break
          }
        }
      } catch (e) {
        logger.warn(`Could not process Continue button: ${selector} - Error: ${e}`)
        continue
      }
    }

    // Fallback: find by text content
    if (!verificationContinueClicked) {
      try {
        logger.info("Searching for Continue button by text content...")
        const continueButton = await this.page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll("button"))
          return buttons.find((btn) => {
            const text = (btn as any).textContent?.trim()
            return text && text.includes("Continue") && !(btn as any).disabled && !(btn as any).hasAttribute("disabled")
          })
        })

        if (continueButton) {
          const buttonText = await this.page.evaluate((el) => (el as any).textContent?.trim(), continueButton as any)
          logger.success(`Found Continue button by text: "${buttonText}"`)

          const randomClickDelay = Math.floor(Math.random() * 1000) + 500
          await delay(randomClickDelay)

          await (continueButton as any).click()
          logger.success(`Continue button clicked (by text search): "${buttonText}"`)
          verificationContinueClicked = true
        }
      } catch (e) {
        logger.warn(`Could not find Continue button by text search: ${e}`)
      }
    }

    if (!verificationContinueClicked) {
      logger.error("CRITICAL: Could not click Continue button - cannot proceed to password creation")
      logger.warn("This might be due to anti-bot protection. Please check if captcha appeared.")
      await this.page.screenshot({ path: "continue-button-failed.png", fullPage: true })
      return false
    }

    // Restore proxy setting
    if (wasUsingStableMode) {
      logger.info("STABLE MODE: Restoring proxy for password creation")
      this.config.useProxy = 5
    }

    return true
  }

  async waitForPasswordPage(): Promise<boolean> {
    logger.info("Waiting for password creation page to load...")
    await this.proxyAwareDelay(3000)

    const passwordFieldExists = await this.page.$('#registerForm_newPassword, input[placeholder*="New password"]')
    if (!passwordFieldExists) {
      logger.error("Password creation page did not load properly")
      await this.page.screenshot({ path: "password-page-failed.png", fullPage: true })
      return false
    }

    logger.success("Successfully transitioned to password creation page")
    await this.proxyAwareDelay(1500)

    return true
  }

  async fillPasswordFields(): Promise<boolean> {
    logger.info("Handling password creation page...")

    try {
      await this.page.waitForSelector('#registerForm_newPassword, input[placeholder*="New password"]', {
        timeout: this.getProxyAwareTimeout(5000),
      })
      logger.success("Password creation form loaded")
    } catch (e) {
      logger.error("Password creation form did not load - Continue button failed")
      return false
    }

    // Fill new password
    const newPasswordSelectors = [
      "#registerForm_newPassword",
      'input[placeholder*="New password"]',
      'input[autocomplete="new-password"]:first-of-type',
    ]

    let newPasswordFilled = false
    for (const selector of newPasswordSelectors) {
      try {
        const input = await this.page.$(selector)
        if (input) {
          await input.click({ clickCount: 3 })
          await input.type("", { delay: 50 })
          await input.type(this.config.levelinfPassword, { delay: 150 })
          logger.success(`Filled new password field: ${selector}`)
          newPasswordFilled = true
          break
        }
      } catch (e) {
        continue
      }
    }

    // Fill confirm password
    const confirmNewPasswordSelectors = [
      "#registerForm_confirmPassword",
      'input[placeholder*="Confirm new password"]',
      'input[autocomplete="new-password"]:nth-of-type(2)',
    ]

    for (const selector of confirmNewPasswordSelectors) {
      try {
        const input = await this.page.$(selector)
        if (input) {
          await input.click({ clickCount: 3 })
          await input.type("", { delay: 50 })
          await input.type(this.config.levelinfPassword, { delay: 150 })
          logger.success(`Filled confirm new password field: ${selector}`)
          break
        }
      } catch (e) {
        continue
      }
    }

    if (!newPasswordFilled) {
      logger.warn("Could not fill new password fields")
    }

    // Wait for password validation
    const validationDelay = this.proxyManager?.getCurrentProxy() ? 6000 : 4000
    logger.info(`Waiting ${validationDelay / 1000}s for password validation...`)
    await delay(validationDelay)

    try {
      const successElements = await this.page.$$(".infinite-form-item-has-success")
      const errorElements = await this.page.$$(".infinite-form-item-has-error")
      logger.info(`Found ${successElements.length} success indicators, ${errorElements.length} error indicators`)
    } catch (e) {
      logger.warn("Could not check validation status")
    }

    await delay(2000)

    return newPasswordFilled
  }

  async clickDoneButton(): Promise<boolean> {
    const doneSelectors = [
      'button[name="confirm"][type="submit"]',
      'button.infinite-btn-primary:contains("Done")',
      'button:contains("Done")',
      'button[type="submit"]:contains("Done")',
      '.infinite-btn-primary[type="submit"]',
    ]

    for (const selector of doneSelectors) {
      try {
        const button = await this.page.$(selector)
        if (button) {
          const isDisabled = await this.page.evaluate(
            (el) => (el as any).disabled || (el as any).hasAttribute("disabled"),
            button,
          )
          const buttonText = await this.page.evaluate((el) => (el as any).textContent?.trim(), button)

          logger.debug(`Found button: ${selector} - Text: "${buttonText}" - Disabled: ${isDisabled}`)

          if (!isDisabled && buttonText?.includes("Done")) {
            try {
              await button.click()
              logger.success(`Done button clicked (method 1): ${selector}`)
              return true
            } catch (e1) {
              try {
                await this.page.evaluate((btn) => (btn as any).click(), button)
                logger.success(`Done button clicked (method 2 - JS): ${selector}`)
                return true
              } catch (e2) {
                try {
                  const box = await button.boundingBox()
                  if (box) {
                    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
                    logger.success(`Done button clicked (method 3 - mouse): ${selector}`)
                    return true
                  }
                } catch (e3) {
                  logger.error(`All click methods failed for: ${selector}`)
                }
              }
            }
          } else {
            logger.warn(`Button not suitable: ${selector} - Text: "${buttonText}" - Disabled: ${isDisabled}`)
          }
        }
      } catch (e) {
        logger.warn(`Could not process button: ${selector} - Error: ${e}`)
        continue
      }
    }

    logger.warn("Could not find or click Done button. Taking final screenshot...")
    await this.page.screenshot({ path: "final-registration-error.png", fullPage: true })
    logger.info("Final screenshot saved as final-registration-error.png")
    return false
  }
}

export default PasswordHandler
