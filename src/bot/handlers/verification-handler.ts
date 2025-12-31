/* eslint-disable no-var */
declare var window: any
declare var document: any
/* eslint-enable no-var */

import type { Page } from "puppeteer-core"
import { delay, randomDelay } from "../../utils/helpers"
import { logger } from "../../utils/logger"
import type ProxyManager from "../../proxy/proxy-manager"
import type { EmailService } from "../../services/email-service"

export class VerificationHandler {
  private page: Page
  private proxyManager: ProxyManager | null
  private emailService: EmailService
  private config: any

  constructor(page: Page, proxyManager: ProxyManager | null, emailService: EmailService, config: any) {
    this.page = page
    this.proxyManager = proxyManager
    this.emailService = emailService
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

  async clickGetCodeButton(): Promise<boolean> {
    try {
      await this.page.waitForSelector('input[placeholder*="Verification code"], ._1egsyt72', {
        timeout: this.getProxyAwareTimeout(5000),
      })
      logger.info("Verification code input and Get code button found")
    } catch (e) {
      logger.warn("Verification code input not found, taking screenshot...")
      await this.page.screenshot({ path: "verification-form-error.png", fullPage: true })
    }

    const getCodeSelectors = [
      "button._1egsyt72",
      "._1egsyt72",
      "div._1egsyt70 button",
      ".infinite-btn-primary",
      'button[type="button"]',
    ]

    for (const selector of getCodeSelectors) {
      try {
        const buttons = await this.page.$$(selector)
        for (const button of buttons) {
          const buttonText = await this.page.evaluate((el) => el.textContent || "", button)
          if (
            buttonText.toLowerCase().includes("get code") ||
            buttonText.toLowerCase().includes("send code") ||
            buttonText.toLowerCase().includes("send")
          ) {
            const scrollBefore = await this.page.evaluate(() => window.scrollY)
            await button.click()
            logger.info(`Clicked "Get code" button: ${selector}`)
            await this.proxyAwareDelay(1000)
            await this.proxyAwareDelay(1000)

            try {
              const scrollAfter = await this.page.evaluate(() => window.scrollY)

              if (Math.abs(scrollAfter - scrollBefore) > 100) {
                logger.info("Page scrolled after Get code click - attempting to return to verification section")
                await this.page.evaluate(() => {
                  const verificationInput = document.querySelector('input[placeholder*="Verification code"]')
                  if (verificationInput) {
                    ;(verificationInput as any).scrollIntoView({ behavior: "smooth", block: "center" })
                  } else {
                    window.scrollTo({ top: 0, behavior: "smooth" })
                  }
                })
                await delay(2000)
              }
            } catch (pageError) {
              logger.warn("Page became unstable after Get code click, attempting recovery...")
              await delay(5000)
            }

            return true
          }
        }
      } catch (e) {
        continue
      }
    }

    // Fallback: try clicking any button that might be Get code
    try {
      const button = await this.page.$("button._1egsyt72")
      if (button) {
        await button.click()
        logger.info('Clicked "Get code" button (fallback)')
        await this.proxyAwareDelay(2000)
        return true
      }
    } catch (e) {
      logger.warn('Could not click "Get code" button')
    }

    logger.error('Could not find "Get code" button - cannot proceed')
    return false
  }

  async waitForVerificationCode(): Promise<string | null> {
    logger.info("STEP 2: Waiting for verification code...")

    const originalProxySetting = this.config.useProxy
    if (this.config.useProxy === 5) {
      logger.info("STABLE MODE: Temporarily disabling proxy for email verification")
      this.proxyManager?.stopKeepAlive?.()
      this.config.useProxy = 0
    }

    let verificationCode: string | null = null
    let attempts = 0
    const maxAttempts = this.config.maxEmailCheckAttempts

    while (!verificationCode && attempts < maxAttempts) {
      verificationCode = await this.emailService.getVerificationCode()
      if (!verificationCode) {
        attempts++
        logger.info(`Still waiting for verification email... (attempt ${attempts}/${maxAttempts})`)
        await delay(this.config.emailCheckInterval)
      }
    }

    if (originalProxySetting === 5) {
      logger.info("STABLE MODE: Restoring proxy for remaining operations")
      this.config.useProxy = 5
    }

    return verificationCode
  }

  async fillVerificationCode(verificationCode: string): Promise<boolean> {
    const codeSelectors = [
      'input[placeholder*="Verification code"]',
      'input[placeholder*="verification"]',
      'input[placeholder*="code"]',
      'input[type="text"]:not([placeholder*="email"])',
    ]

    for (const selector of codeSelectors) {
      try {
        const input = await this.page.$(selector)
        if (input) {
          await randomDelay(500, 1500)
          await input.click({ clickCount: 3 })
          await input.type("", { delay: 50 })
          await input.type(verificationCode, { delay: 250 })
          logger.success(`Filled verification code: ${verificationCode}`)

          const enteredValue = await this.page.evaluate((el) => (el as any).value, input)
          logger.info(`Verification code in field: "${enteredValue}"`)
          return true
        }
      } catch (e) {
        logger.warn(`Error filling verification code: ${e}`)
        continue
      }
    }

    logger.error("Could not fill verification code")
    return false
  }

  async handleCountrySelection(): Promise<boolean> {
    logger.info("STEP 3: Checking for country/region selection...")

    let countrySelected = false
    let retryCount = 0
    const maxRetries = 3

    while (!countrySelected && retryCount < maxRetries) {
      try {
        logger.info(`Country selection attempt ${retryCount + 1}/${maxRetries}`)

        await this.proxyAwareDelay(1000 + retryCount * 300) // Reduced initial delay

        const countrySelectors = [
          "#area",
          ".infinite-select-selector",
          ".infinite-select",
          "select#area",
          '[class*="select"]',
          'select[name*="country"]',
          'select[name*="region"]',
        ]

        for (const selector of countrySelectors) {
          try {
            const countryElement = await this.page.$(selector)
            if (countryElement) {
              logger.info(`Found country/region selector: ${selector}`)

              // Check if a country is already selected (comprehensive check)
              const selectionCheck = await this.page.evaluate(() => {
                // Check for selected country indicators (like the HTML you showed)
                const selectedElements = document.querySelectorAll(
                  '.infinite-select-selection-item, [class*="selected"], [aria-selected="true"], option[selected]'
                )

                for (const element of selectedElements) {
                  const text = (element as any).textContent?.trim() ||
                              (element as any).title?.trim() ||
                              (element as any).value?.trim()
                  if (text && text.length > 2 &&
                      !text.toLowerCase().includes('select') &&
                      !text.toLowerCase().includes('choose') &&
                      !text.toLowerCase().includes('country')) {
                    return { isSelected: true, selectedCountry: text }
                  }
                }

                // Check traditional select element
                const selectElement = document.querySelector('select#area, select[name*="country"]')
                if (selectElement) {
                  const selectedOption = (selectElement as any).options[(selectElement as any).selectedIndex]
                  const selectedText = selectedOption ? selectedOption.textContent?.toLowerCase().trim() : ""
                  if (selectedText && selectedText.length > 2 &&
                      !selectedText.includes('select') && !selectedText.includes('choose')) {
                    return { isSelected: true, selectedCountry: selectedOption.textContent?.trim() }
                  }
                }

                return { isSelected: false, selectedCountry: null }
              })

              // Handle country selection based on config and current state
              if (selectionCheck.isSelected) {
                if (this.config.disableCountryDropdown) {
                  // Respect auto-selected country
                  logger.success(`Country already selected by site: ${selectionCheck.selectedCountry} (respected auto-selection)`)
                  countrySelected = true
                  break
                } else {
                  // Force random selection even if already selected
                  logger.info(`Country already selected (${selectionCheck.selectedCountry}) but forcing random selection...`)
                  // Continue with dropdown manipulation below
                }
              } else {
                // No country selected, proceed with selection
                logger.info("No country pre-selected, proceeding with dropdown selection...")
              }

              // Use typing approach instead of scrolling through dropdown
              await countryElement.click()
              logger.info(`Clicked country/region selector: ${selector}`)
              await this.proxyAwareDelay(800)

              // Clear any existing text first
              await this.page.keyboard.down('Control')
              await this.page.keyboard.press('a')
              await this.page.keyboard.up('Control')
              await this.page.keyboard.press('Backspace')
              await this.proxyAwareDelay(200)

              // List of common countries to randomly select from
              const countryList = [
                "Germany", "France", "Italy", "Spain", "Netherlands", "Belgium",
                "Switzerland", "Austria", "Sweden", "Norway", "Denmark", "Finland",
                "Poland", "Czech Republic", "Hungary", "Slovakia", "Slovenia",
                "Croatia", "Serbia", "Bosnia and Herzegovina", "Montenegro",
                "Kosovo", "Albania", "North Macedonia", "Greece", "Bulgaria",
                "Romania", "Moldova", "Ukraine", "Belarus", "Lithuania",
                "Latvia", "Estonia", "Ireland", "United Kingdom", "Portugal",
                "Canada", "Australia", "New Zealand", "Japan", "South Korea",
                "Singapore", "Malaysia", "Thailand", "Indonesia", "Vietnam",
                "Philippines", "India", "Pakistan", "Bangladesh", "Sri Lanka",
                "Nepal", "Bhutan", "Maldives", "Turkey", "Israel", "Jordan",
                "Lebanon", "Syria", "Iraq", "Iran", "Saudi Arabia", "UAE",
                "Qatar", "Kuwait", "Bahrain", "Oman", "Yemen", "Egypt",
                "Morocco", "Algeria", "Tunisia", "Libya", "Sudan", "Ethiopia",
                "Kenya", "Tanzania", "Uganda", "Rwanda", "Burundi", "Zimbabwe",
                "South Africa", "Namibia", "Botswana", "Zambia", "Malawi",
                "Mozambique", "Angola", "Nigeria", "Ghana", "Ivory Coast",
                "Senegal", "Mali", "Burkina Faso", "Niger", "Chad", "Cameroon",
                "Gabon", "Congo", "DR Congo", "Central African Republic",
                "Sudan", "South Sudan", "Somalia", "Djibouti", "Eritrea",
                "Mexico", "Brazil", "Argentina", "Chile", "Colombia", "Peru",
                "Venezuela", "Ecuador", "Bolivia", "Paraguay", "Uruguay",
                "Cuba", "Jamaica", "Haiti", "Dominican Republic", "Puerto Rico"
              ]

              // Select random country
              const randomCountry = countryList[Math.floor(Math.random() * countryList.length)]

              // Type the country name
              await this.page.keyboard.type(randomCountry, { delay: 150 })
              logger.info(`Typed country name: ${randomCountry}`)

              // Wait for dropdown to filter and show results
              await this.proxyAwareDelay(1000)

              // Try to select the first matching option
              const selectionResult = await this.page.evaluate((countryName) => {
                // Look for the typed country in dropdown options
                const options = document.querySelectorAll(
                  'li[class*="option"], [class*="dropdown"] li, .ant-select-dropdown li, .infinite-select-dropdown li'
                )

                for (const option of options) {
                  const text = (option as any).textContent?.trim() || ""
                  if (text.toLowerCase().includes(countryName.toLowerCase()) ||
                      text === countryName) {
                    ;(option as any).click()
                    return text
                  }
                }

                // If no exact match, try pressing Enter to select first result
                return null
              }, randomCountry)

              if (selectionResult) {
                logger.success(`Selected country: ${selectionResult}`)
                countrySelected = true
                await this.proxyAwareDelay(500)
              } else {
                // Press Enter to select the first filtered result
                await this.page.keyboard.press('Enter')
                logger.success(`Selected country by Enter key: ${randomCountry}`)
                countrySelected = true
                await this.proxyAwareDelay(500)
              }

              // Check if country selection affected age checkbox
              const selectedCountryName = selectionResult || randomCountry
              try {
                const ageCheckbox = await this.page.$('#adultAge')
                if (ageCheckbox) {
                  const ageCheckedAfterCountry = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
                  const ageTextAfterCountry = await this.page.evaluate((el) => {
                    const label = (el as any).closest('label')
                    return label ? label.textContent?.trim() : 'Unknown'
                  }, ageCheckbox)

                  logger.debug(`After selecting ${selectedCountryName}: age checked=${ageCheckedAfterCountry}, text="${ageTextAfterCountry?.substring(0, 50)}..."`)

                  if (ageCheckedAfterCountry && !this.config.enableAgeConfirmation) {
                    logger.warn(`Age checkbox was auto-checked after selecting ${selectedCountryName}!`)
                  }
                }
              } catch (e) {
                logger.warn(`Could not check age checkbox after country selection: ${e}`)
              }

              break
            }
          } catch (e) {
            logger.warn(`Error with selector ${selector}: ${e}`)
            continue
          }
        }

        if (!countrySelected) {
          retryCount++
          if (retryCount < maxRetries) {
            logger.warn(`Country selection failed, retrying in 1 second... (${retryCount}/${maxRetries})`)
            await this.proxyAwareDelay(1000) // Reduced retry delay
          }
        }
      } catch (countryError) {
        logger.warn(`Country selection error (attempt ${retryCount + 1}): ${countryError}`)
        retryCount++
        if (retryCount < maxRetries) {
          await this.proxyAwareDelay(1000)
        }
      }
    }

    if (countrySelected) {
      logger.success("Country/region selection handled successfully")
      await this.proxyAwareDelay(800)
    } else {
      logger.warn("Country/region selection failed after all retries - continuing anyway")
    }

    return countrySelected
  }

  async handleAgeVerification(): Promise<boolean> {
    logger.info("Checking for age verification...")

    let ageHandled = false
    let ageRetryCount = 0
    const maxAgeRetries = 2

    while (!ageHandled && ageRetryCount < maxAgeRetries) {
      try {
        const ageSelectors = [
          'input[type="number"][placeholder*="age" i]',
          'input[placeholder*="age" i]',
          'input[name*="age"]',
          'select[name*="age"]',
          'select[placeholder*="age" i]',
          '[class*="age"] input',
          '[class*="age"] select',
          'input[id*="age"]',
          'select[id*="age"]',
        ]

        for (const ageSelector of ageSelectors) {
          try {
            const ageElement = await this.page.$(ageSelector)
            if (ageElement) {
              logger.info(`Found age input: ${ageSelector}`)

              await this.proxyAwareDelay(500)

              const tagName = await this.page.evaluate((el) => (el as any).tagName.toLowerCase(), ageElement)

              if (tagName === "select") {
                logger.info(`Clicking age selector: ${ageSelector}`)
                await ageElement.click()
                await this.proxyAwareDelay(500)

                const ageSelected = await this.page.evaluate(() => {
                  const options = document.querySelectorAll('option, li[class*="option"]')
                  for (let i = 0; i < options.length; i++) {
                    const option = options[i]
                    const text = (option as any).textContent || ""
                    const value = (option as any).value || ""
                    const ageNum = Number.parseInt(text) || Number.parseInt(value)
                    if (ageNum >= 18 && ageNum <= 65) {
                      ;(option as any).click()
                      return ageNum
                    }
                  }
                  if (options.length > 1) {
                    ;(options[1] as any).click()
                    return (options[1] as any).textContent
                  }
                  return null
                })

                if (ageSelected) {
                  logger.success(`Selected age: ${ageSelected}`)
                  ageHandled = true
                  break
                }
              } else {
                // It's an input field
                const randomAge = Math.floor(Math.random() * (45 - 21 + 1)) + 21
                await ageElement.click({ clickCount: 3 })
                await ageElement.type(randomAge.toString(), { delay: 150 })
                logger.success(`Entered age: ${randomAge}`)
                ageHandled = true
                break
              }
            }
          } catch (e) {
            continue
          }
        }

        if (!ageHandled) {
          ageRetryCount++
          if (ageRetryCount < maxAgeRetries) {
            logger.warn(`Age verification retry... (${ageRetryCount}/${maxAgeRetries})`)
            await this.proxyAwareDelay(1500)
          }
        }
      } catch (ageError) {
        logger.warn(`Age verification error: ${ageError}`)
        ageRetryCount++
        if (ageRetryCount < maxAgeRetries) {
          await this.proxyAwareDelay(1500)
        }
      }
    }

    if (!ageHandled) {
      logger.info("No age verification found or could not handle - continuing")
    }

    return ageHandled
  }


  async handleAgreementCheckboxes(): Promise<boolean> {
    logger.info("Looking for agreement checkboxes...")

    // Debug: Log all checkbox states before any interaction
    try {
      const allCheckboxes = await this.page.$$('input[type="checkbox"]')
      logger.info(`Found ${allCheckboxes.length} total checkboxes on page`)

      for (let i = 0; i < allCheckboxes.length; i++) {
        const checkbox = allCheckboxes[i]
        const id = await this.page.evaluate((el) => (el as any).id || '', checkbox)
        const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
        const labelText = await this.page.evaluate((el) => {
          const label = el.closest('label')
          return label ? label.textContent?.trim()?.substring(0, 30) + '...' : ''
        }, checkbox)

        if (id) {
          logger.debug(`Checkbox #${i}: id=${id}, checked=${isChecked}, label="${labelText}"`)
        }
      }
    } catch (e) {
      logger.warn(`Could not log initial checkbox states: ${e}`)
    }

    let checkboxCount = 0

    // PROACTIVE PROTECTION: Disable age checkbox immediately if confirmation is disabled
    if (!this.config.enableAgeConfirmation) {
      try {
        await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById('adultAge') as any
          if (ageCheckbox) {
            // Immediately disable and uncheck
            ageCheckbox.checked = false
            ageCheckbox.disabled = true

            // Try to override checked property (may fail if already defined)
            try {
              Object.defineProperty(ageCheckbox, 'checked', {
                get: () => false,
                set: () => false, // Always return false
                configurable: true // Allow reconfiguration
              })
            } catch (e) {
              // If property override fails, rely on event prevention
              console.warn('Could not override checked property, using event prevention only')
            }

            // Prevent all interaction events
            const preventCheck = (e: any) => {
              ageCheckbox.checked = false
              e.preventDefault()
              e.stopImmediatePropagation()
            }

            ageCheckbox.addEventListener('change', preventCheck, true)
            ageCheckbox.addEventListener('click', preventCheck, true)
            ageCheckbox.addEventListener('input', preventCheck, true)

            console.log('Age confirmation checkbox proactively disabled')
          }
        })
        logger.info("Proactive age confirmation protection applied")
      } catch (e) {
        logger.warn(`Could not apply proactive age confirmation protection: ${e}`)
      }
    }

    // Handle checkboxes based on age confirmation config
    if (this.config.enableAgeConfirmation) {
      // If age confirmation is enabled, check all required agreements
      const requiredSelectors = [
        "#agreedPp",    // Privacy Policy (required)
        "#agreedTos",   // Terms of Service (required)
        "#agreedAllLi", // Combined agreement (required)
      ]

      for (const selector of requiredSelectors) {
        try {
          const checkbox = await this.page.$(selector)
          if (checkbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
            if (!isChecked) {
              await checkbox.click()
              checkboxCount++
              logger.info(`Checked agreement: ${selector}`)
              await this.proxyAwareDelay(300)
            }
          }
        } catch (e) {
          continue
        }
      }

      // Ensure age confirmation is checked
      try {
        const ageCheckbox = await this.page.$('#adultAge')
        if (ageCheckbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
          if (!isChecked) {
            await ageCheckbox.click()
            checkboxCount++
            logger.info("Checked age confirmation")
            await this.proxyAwareDelay(300)
          } else {
            logger.debug("Age confirmation already checked")
          }
        }
      } catch (e) {
        logger.warn(`Could not check age confirmation: ${e}`)
      }

    } else {
      // If age confirmation is disabled, only check these two specific checkboxes
      // AVOID checking the "I confirm the following:" master checkbox as it auto-checks age confirmation
      const allowedSelectors = [
        "#agreedAllLi",   // Combined ToS + Privacy Policy agreement (required)
        "#agreedIsEmail", // Email subscription (optional but allowed)
        // Explicitly SKIP: "I confirm the following:" master checkbox (would auto-check age)
        // Explicitly SKIP: #adultAge (age confirmation disabled per config)
      ]

      for (const selector of allowedSelectors) {
        try {
          const checkbox = await this.page.$(selector)
          if (checkbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
            if (!isChecked) {
              await checkbox.click()
              checkboxCount++
              logger.info(`Checked agreement: ${selector}`)
              await this.proxyAwareDelay(300)

              // Immediately check if age confirmation got auto-checked after this click
              if (!this.config.enableAgeConfirmation) {
                try {
                  const ageState = await this.page.evaluate(() => {
                    const ageCheckbox = document.getElementById('adultAge') as any
                    return ageCheckbox ? { checked: ageCheckbox.checked, disabled: ageCheckbox.disabled } : null
                  })

                  if (ageState && ageState.checked && !ageState.disabled) {
                    logger.warn(`Age confirmation auto-checked after clicking ${selector}, unchecking...`)
                    await this.page.evaluate(() => {
                      const ageCheckbox = document.getElementById('adultAge') as any
                      if (ageCheckbox) {
                        ageCheckbox.checked = false
                      }
                    })
                  }
                } catch (e) {
                  logger.warn(`Could not check age state after ${selector}: ${e}`)
                }
              }
            }
          }
        } catch (e) {
          continue
        }
      }

      // Multiple attempts to ensure age confirmation stays unchecked
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ageCheckbox = await this.page.$('#adultAge')
          if (ageCheckbox) {
            const isChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
            const ageText = await this.page.evaluate((el) => {
              const label = (el as any).closest('label')
              return label ? label.textContent?.trim() : 'Unknown'
            }, ageCheckbox)

            logger.info(`Age checkbox state (attempt ${attempt + 1}): checked=${isChecked}, text="${ageText?.substring(0, 50)}..."`)

            if (isChecked) {
              logger.info(`Age confirmation was checked (attempt ${attempt + 1}), unchecking...`)
              await ageCheckbox.click() // Uncheck if it was auto-checked
              await this.proxyAwareDelay(500)

              // Verify it was actually unchecked
              const stillChecked = await this.page.evaluate((el) => (el as any).checked, ageCheckbox)
              if (!stillChecked) {
                logger.info("Successfully unchecked age confirmation")
                break
              } else {
                logger.warn(`Failed to uncheck age confirmation on attempt ${attempt + 1}`)
              }
            } else {
              logger.debug("Age confirmation already unchecked")
              break
            }
          } else {
            logger.warn(`Age checkbox element not found on attempt ${attempt + 1}`)
          }
        } catch (e) {
          logger.warn(`Could not handle age confirmation unchecking (attempt ${attempt + 1}): ${e}`)
          await this.proxyAwareDelay(300)
        }
      }

      // Also check master checkbox and uncheck it if it would auto-check age
      try {
        const masterCheckbox = await this.page.$('#agreedAllLi')
        if (masterCheckbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, masterCheckbox)
          if (isChecked) {
            logger.info("Master checkbox was checked, unchecking to prevent auto-checking age confirmation")
            await masterCheckbox.click()
            await this.proxyAwareDelay(300)
          }
        }
      } catch (e) {
        logger.warn(`Could not handle master checkbox: ${e}`)
      }

      logger.info("Age confirmation checkbox skipped (disabled in config)")
    }

    // Optional checkboxes (email subscriptions) - check these regardless
    const optionalSelectors = [
      "#agreedIsEmail",      // General email subscription
      "#agreedKoNightEmail", // Korean night email (optional)
    ]

    for (const selector of optionalSelectors) {
      try {
        const checkbox = await this.page.$(selector)
        if (checkbox) {
          const isChecked = await this.page.evaluate((el) => (el as any).checked, checkbox)
          if (!isChecked) {
            await checkbox.click()
            checkboxCount++
            logger.debug(`Checked optional agreement: ${selector}`)
            await this.proxyAwareDelay(200)
          }
        }
      } catch (e) {
        continue
      }
    }

    // Also try clicking labels that might be checkboxes
    try {
      await this.page.evaluate(() => {
        const labels = document.querySelectorAll('label[class*="checkbox"], label[for*="agree"]')
        labels.forEach((label: any) => {
          const input = label.querySelector('input[type="checkbox"]') || document.getElementById(label.htmlFor)
          if (input && !input.checked) {
            label.click()
          }
        })
      })
    } catch (e) {
      // Ignore errors
    }

    // Final verification and forced prevention for age confirmation
    if (!this.config.enableAgeConfirmation) {
      try {
        // Final aggressive prevention - disable the checkbox entirely
        await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById('adultAge') as any
          if (ageCheckbox) {
            // Force uncheck and disable the checkbox
            ageCheckbox.checked = false
            ageCheckbox.disabled = true

            // Try to prevent future checking (may fail if property already configured)
            try {
              Object.defineProperty(ageCheckbox, 'checked', {
                get: () => false,
                set: (value: boolean) => {
                  if (value) {
                    console.warn('Age confirmation checkbox was attempted to be checked - blocking')
                    // Force it back to unchecked after a short delay
                    setTimeout(() => {
                      ageCheckbox.checked = false
                    }, 10)
                  }
                  return false
                },
                configurable: true
              })
            } catch (e) {
              console.warn('Could not configure checked property override, using event prevention only')
            }

            // Add event listeners to prevent checking
            ageCheckbox.addEventListener('change', (e: any) => {
              if (ageCheckbox.checked) {
                console.warn('Age confirmation checkbox change event blocked')
                ageCheckbox.checked = false
                e.preventDefault()
                e.stopPropagation()
              }
            })

            ageCheckbox.addEventListener('click', (e: any) => {
              if (!ageCheckbox.disabled) {
                console.warn('Age confirmation checkbox click blocked')
                e.preventDefault()
                e.stopPropagation()
                ageCheckbox.checked = false
              }
            })

            console.log('Age confirmation checkbox disabled and protected')
          }
        })

        // Verify the protection worked
        await this.proxyAwareDelay(100)
        const finalState = await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById('adultAge') as any
          return ageCheckbox ? ageCheckbox.checked : null
        })

        if (finalState) {
          logger.error("CRITICAL: Age confirmation protection failed - checkbox is still checked!")
        } else {
          logger.info("✅ Age confirmation protection successful - checkbox disabled and unchecked")
        }

      } catch (e) {
        logger.error(`Could not apply age confirmation protection: ${e}`)
      }
    }

    // Final comprehensive check for age confirmation
    if (!this.config.enableAgeConfirmation) {
      try {
        const finalAgeState = await this.page.evaluate(() => {
          const ageCheckbox = document.getElementById('adultAge') as any
          const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => ({
            id: (cb as any).id,
            checked: (cb as any).checked
          }))
          return {
            ageChecked: ageCheckbox ? ageCheckbox.checked : null,
            ageDisabled: ageCheckbox ? ageCheckbox.disabled : null,
            allCheckboxes
          }
        })

        if (finalAgeState.ageChecked) {
          logger.error(`FINAL CHECK FAILED: Age confirmation is still checked! Disabled: ${finalAgeState.ageDisabled}`)
          logger.error(`All checkbox states: ${JSON.stringify(finalAgeState.allCheckboxes)}`)

          // Emergency uncheck
          await this.page.evaluate(() => {
            const ageCheckbox = document.getElementById('adultAge') as any
            if (ageCheckbox) {
              ageCheckbox.checked = false
              ageCheckbox.disabled = true
            }
          })
          logger.warn("Emergency age confirmation uncheck applied")
        } else {
          logger.info("✅ Final verification: Age confirmation properly unchecked")
        }
      } catch (e) {
        logger.error(`Could not perform final age verification: ${e}`)
      }
    }

    if (checkboxCount > 0) {
      logger.success(`Checked ${checkboxCount} agreement checkbox(es)`)
    } else {
      logger.info("No unchecked agreement checkboxes found")
    }

    return true
  }
}

export default VerificationHandler
