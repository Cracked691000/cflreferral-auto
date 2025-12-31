/* eslint-disable no-var */
declare var window: any
declare var document: any
declare var navigator: any
/* eslint-enable no-var */

import puppeteer, { type Browser, type Page } from "puppeteer-core"
import type { RegistrationConfig, ProxyInfo } from "../types"
import { logger } from "../utils/logger"
import { delay, saveSuccessfulAccount } from "../utils/helpers"
import { loadConfig } from "../config"
import { EmailService } from "../services/email-service"
import ProxyManager from "../proxy/proxy-manager"
import { QuantumProxyManager } from "../proxy/quantum-proxy-manager"
import { SecureConnectionManager } from "../proxy/secure-connection-manager"
import { RegistrationHandler } from "./handlers/registration-handler"
import { VerificationHandler } from "./handlers/verification-handler"
import { PasswordHandler } from "./handlers/password-handler"

export class CrossfireReferralBot {
  private browser: Browser | null = null
  private page: Page | null = null
  private config: ReturnType<typeof loadConfig>
  private currentEmail = ""
  private sessionPassword: string
  private proxyManager: ProxyManager | null = null
  private quantumProxyManager: QuantumProxyManager | null = null
  private secureConnectionManager: SecureConnectionManager | null = null
  private emailService: EmailService

  constructor(registrationConfig: RegistrationConfig) {
    this.config = loadConfig()
    this.currentEmail = registrationConfig.email
    this.sessionPassword = registrationConfig.password
    this.emailService = new EmailService()

    if (this.config.useProxy && this.config.useProxy > 0) {
      this.proxyManager = new ProxyManager({
        proxyType: this.config.useProxy,
        proxyFile: this.config.proxyFile,
        socks5Urls: this.config.socks5Urls,
        socks4Urls: this.config.socks4Urls,
        testTimeout: this.config.proxyTimeout,
        maxConcurrentTests: this.config.proxyMaxConcurrentTests,
        testCount: this.config.proxyTestCount,
        verbose: this.config.debugMode
      })
    }
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

  private async detectBrowserExecutable(): Promise<string | undefined> {
    const { execSync } = require('child_process')

    // Common browser executable paths and commands
    const browserPaths = [
      // Termux/Android paths
      '/data/data/com.termux/files/usr/bin/chromium',
      '/data/data/com.termux/files/usr/bin/chromium-browser',
      '/data/data/com.termux/files/usr/bin/google-chrome',

      // Linux paths
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/chrome',
      '/usr/bin/firefox',

      // macOS paths
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Firefox.app/Contents/MacOS/firefox',

      // Windows paths
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Chromium\\Application\\chromium.exe',
    ]

    // Try to find browser using which command first (Unix-like systems)
    const whichCommands = ['chromium', 'chromium-browser', 'google-chrome', 'chrome', 'firefox']
    for (const cmd of whichCommands) {
      try {
        const path = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim()
        if (path) {
          logger.info(`Found browser via which: ${path}`)
          return path
        }
      } catch (e) {
        // Continue to next command
      }
    }

    // Check predefined paths
    for (const path of browserPaths) {
      try {
        require('fs').accessSync(path, require('fs').constants.F_OK)
        logger.info(`Found browser at: ${path}`)
        return path
      } catch (e) {
        // Path doesn't exist, continue
      }
    }

    logger.warn("No browser executable found, using Puppeteer's default")
    return undefined
  }

  async launchFreshBrowser(): Promise<void> {
    logger.info("Launching fresh browser instance...")

    // Detect browser executable
    const browserExecutable = await this.detectBrowserExecutable()
    if (browserExecutable) {
      logger.info(`Using browser: ${browserExecutable}`)
    }

    const browserArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-web-security",
      "--disable-features=BlockInsecurePrivateNetworkRequests",
      `--window-size=${this.config.viewportWidth},${this.config.viewportHeight}`,
      `--user-agent=${this.config.userAgent}`,
    ]

    if (this.config.useProxy && this.config.useProxy > 0 && this.proxyManager) {
      logger.info("Getting working proxy for browser launch...")
      const workingProxy = await this.proxyManager.getWorkingProxy()
      if (workingProxy) {
        const proxyServer = `${workingProxy.protocol}://${workingProxy.host}:${workingProxy.port}`
        browserArgs.push(`--proxy-server=${proxyServer}`)
        logger.info(`Using tested proxy: ${proxyServer}`)
      } else {
        logger.warn("No working proxy found, proceeding without proxy")
      }
    }

    const launchOptions: any = {
      headless: this.config.headless,
      args: browserArgs,
      defaultViewport: {
        width: this.config.viewportWidth,
        height: this.config.viewportHeight,
      },
    }

    // Add executable path if detected (required for puppeteer-core)
    if (browserExecutable) {
      launchOptions.executablePath = browserExecutable
    }

    this.browser = await puppeteer.launch(launchOptions)

    this.page = await this.browser.newPage()

    await this.page.setBypassCSP(true)

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      })
      ;(window as any).chrome = { runtime: {} }
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      })
      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      })
    })

    this.page.on("dialog", async (dialog) => {
      logger.info(`JavaScript dialog detected: ${dialog.message()}`)
      await dialog.accept()
      logger.info("Dialog accepted")
    })

    // Initialize secure connection manager for ALL connections (direct or proxy)
    this.secureConnectionManager = new SecureConnectionManager({
      enableCertificatePinning: true,
      enableClientCertificates: this.config.enableClientCertificates,
      allowedNetworks: this.config.allowedNetworks,
      blockedNetworks: this.config.blockedNetworks,
      tlsFingerprintCheck: true,
      maxTlsVersion: "TLSv1.3",
      minTlsVersion: "TLSv1.2"
    })

    logger.info("🔐 Secure connection manager initialized for all connections")

    // Perform security audit for direct connections (no proxy)
    if (this.config.useProxy === 0) {
      this.performDirectConnectionSecurityAudit()
    }

    // Initialize quantum proxy manager for conservative proxy usage (only when proxy is enabled)
    if (this.config.useProxy > 0 && this.proxyManager) {
      const currentProxy = this.proxyManager.getCurrentProxy()
      if (currentProxy) {
        this.quantumProxyManager = new QuantumProxyManager('act.playcfl.com')

        // Configure security features
        if (this.config.enableClientCertificates &&
            this.config.privateKeyPath &&
            this.config.certificatePath) {
          this.quantumProxyManager.configureClientCertificates(
            this.config.privateKeyPath,
            this.config.certificatePath,
            this.config.caCertificatePath
          )
        }

        // Configure network access controls
        this.quantumProxyManager.configureNetworkAccess(
          this.config.allowedNetworks,
          this.config.blockedNetworks
        )

        const quantumConfig = {
          host: currentProxy.host,
          port: currentProxy.port,
          protocol: currentProxy.protocol as 'http' | 'https' | 'socks4' | 'socks5'
        }

        this.quantumProxyManager.initializeQuantumConnection(quantumConfig).then(async (success) => {
          if (success) {
            logger.info('⚛️  Quantum proxy initialized - proxy conserved for target site only')

            // Start keep-alive pinging to maintain proxy connection
            this.quantumProxyManager!.startKeepAlive()

            // Perform security audit
            try {
              const audit = await this.quantumProxyManager!.performSecurityAudit()
              logger.info(`🔒 Security Audit: Score ${audit.score}/100 (${audit.riskLevel} risk)`)
              if (audit.vulnerabilities.length > 0) {
                logger.warn(`⚠️  Security issues: ${audit.vulnerabilities.join(', ')}`)
              }
            } catch (auditError) {
              logger.warn(`⚠️  Security audit failed: ${auditError}`)
            }
          } else {
            logger.warn('⚠️  Quantum proxy initialization failed, using standard proxy')
          }
        }).catch(error => {
          logger.warn(`⚠️  Quantum proxy error: ${error}`)
        })
      }
    }

    if (this.config.useProxy && this.config.useProxy > 0 && this.proxyManager) {
      const currentProxy = this.proxyManager.getCurrentProxy() as ProxyInfo | null
      if (currentProxy && currentProxy.username && currentProxy.password) {
        await this.page.authenticate({
          username: currentProxy.username,
          password: currentProxy.password,
        })
        logger.info("Proxy authentication configured")
      }
    }

    logger.success("Fresh browser launched successfully")
  }

  async navigateToReferralPage(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized")

    const referralUrl = `${this.config.levelinfBaseUrl}${this.config.referralCode}`
    logger.info(`Navigating to referral page: ${referralUrl}`)

    const navigationTimeout = this.getProxyAwareTimeout(this.config.navigationTimeout)

    try {
      await this.page.goto(referralUrl, {
        waitUntil: "networkidle2",
        timeout: navigationTimeout,
      })
      logger.success("Page loaded successfully")
    } catch (error) {
      logger.warn("Initial navigation timed out, retrying with longer timeout...")

      try {
        await this.page.goto(referralUrl, {
          waitUntil: "domcontentloaded",
          timeout: navigationTimeout * 1.5,
        })
        logger.success("Page loaded (DOM ready)")
      } catch (retryError) {
        if (this.proxyManager) {
          logger.info("Attempting proxy recovery...")
          const recovered = await this.performAdvancedProxyRecovery()
          if (recovered) {
            await this.page.goto(referralUrl, {
              waitUntil: "domcontentloaded",
              timeout: navigationTimeout * 2,
            })
          } else {
            throw retryError
          }
        } else {
          logger.error("All navigation attempts failed")
          throw retryError
        }
      }
    }
  }

  private async performAdvancedProxyRecovery(): Promise<boolean> {
    logger.info("Performing advanced proxy recovery...")
    if (this.proxyManager) {
      await this.proxyManager.switchToNextProxy()
      return true
    }
    return false
  }

  async performRegistration(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized")

    logger.info("Starting registration process...")
    const registrationHandler = new RegistrationHandler(this.page, this.proxyManager, this.currentEmail, this.config)

    try {
      logger.debug("Waiting for login button to appear...")

      await registrationHandler.findAndClickLoginButton()
      await delay(2000)

      await registrationHandler.fillEmailInput()
      await registrationHandler.fillPasswordInput()

      const submitClicked = await registrationHandler.clickSubmitButton()
      if (!submitClicked) return

      logger.debug("Waiting for registration form to load...")
      await this.proxyAwareDelay(4000)

      // Check for registration form elements
      logger.info("Checking for registration form elements...")
      try {
        const registerButtonExists = await this.page.$(`.login-goRegister__button`)
        const emailInputExists = await this.page.$(`input[type="email"]`)

        logger.info(`Register button found: ${!!registerButtonExists}`)
        logger.info(`Email input found: ${!!emailInputExists}`)

        if (!registerButtonExists || !emailInputExists) {
          logger.info("Registration form elements not ready, waiting longer...")
          await this.proxyAwareDelay(3000)
        }
      } catch (debugError) {
        logger.warn("Could not check registration form elements")
      }

      await this.proxyAwareDelay(1000)
      await registrationHandler.clickRegisterForFreeButton()

      const formReady = await registrationHandler.waitForRegistrationForm()
      if (!formReady) {
        logger.info("Attempting proxy recovery due to form loading failure...")
        const recovered = await this.performAdvancedProxyRecovery()
        if (recovered) {
          logger.info("Proxy recovered, restarting registration process...")
          return await this.performRegistration()
        }
        return
      }

      logger.info("Filling registration form...")
      await registrationHandler.fillRegistrationEmail()

      logger.info("Waiting for email validation...")
      await delay(2000)

      const hasEmailError = await this.page.$(".infinite-form-item-has-error #registerForm_account")
      if (hasEmailError) {
        logger.warn("Email validation error still present")
      } else {
        logger.success("Email validation passed")
      }

      logger.info("Registration form ready, proceeding to verification step...")
      logger.info("Skipping password fields in first step - will be filled after email verification")

      await registrationHandler.clickRegistrationSubmit()

      // Handle verification step
      await this.handleVerificationStep()

      // Check for post-registration alerts
      logger.info("Checking for post-registration alerts...")
      await this.handlePostRegistrationAlerts()

      logger.success("Registration process completed")
    } catch (error) {
      logger.error(`Error during registration: ${error}`)
      await this.page.screenshot({ path: "error-screenshot.png", fullPage: true })
      logger.info("Error screenshot saved as error-screenshot.png")
    }
  }

  async handleVerificationStep(): Promise<void> {
    logger.info("Starting email verification step...")

    if (!this.page) {
      logger.error("No page available for verification step")
      return
    }

    const verificationHandler = new VerificationHandler(this.page, this.proxyManager, this.emailService, this.config)
    const passwordHandler = new PasswordHandler(this.page, this.proxyManager, this.config)

    try {
      // Wait for verification form elements
      try {
        await this.page.waitForSelector(
          'input[placeholder*="Verification code"], input[placeholder*="verification"], #registerForm_account',
          { timeout: this.getProxyAwareTimeout(10000) },
        )
      } catch (e) {
        logger.warn("Verification form elements not found, continuing...")
      }

      const codeRequested = await verificationHandler.clickGetCodeButton()
      if (!codeRequested) return

      // Stabilization after Get code click
      logger.info("Stabilizing after Get code click...")
      await delay(4000)

      // Final check that verification elements are still present
      const verificationInput = await this.page.waitForSelector('input[placeholder*="Verification code"]', {
        timeout: this.getProxyAwareTimeout(5000),
      })
      const passwordField = await this.page.$('input[placeholder*="New password"], #registerForm_newPassword')

      if (!verificationInput) {
        logger.error("Verification page lost after Get code click - stopping process")
        return
      }

      if (passwordField) {
        logger.warn("Password fields appeared prematurely - page may have auto-transitioned")
        logger.info("Attempting to return to verification step...")

        await this.page.evaluate(() => {
          const verificationInput = document.querySelector('input[placeholder*="Verification code"]')
          if (verificationInput) {
            verificationInput.scrollIntoView({ behavior: "smooth", block: "center" })
            ;(verificationInput as any).focus()
          }
        })

        await delay(2000)
      }

      logger.info("Verification page stable, waiting for email...")

      const verificationCode = await verificationHandler.waitForVerificationCode()
      if (!verificationCode) {
        logger.error("Could not retrieve verification code - stopping process")
        return
      }

      const codeFilled = await verificationHandler.fillVerificationCode(verificationCode)
      if (!codeFilled) return

      await verificationHandler.handleCountrySelection()
      await verificationHandler.handleAgeVerification()
      await verificationHandler.handleAgreementCheckboxes()

      const continueClicked = await passwordHandler.clickContinueButton()
      if (!continueClicked) return

      const passwordPageLoaded = await passwordHandler.waitForPasswordPage()
      if (!passwordPageLoaded) return

      await passwordHandler.fillPasswordFields()

      const doneClicked = await passwordHandler.clickDoneButton()
      if (doneClicked) {
        logger.super("REGISTRATION COMPLETED SUCCESSFULLY!")
        logger.success(`Account created with email: ${this.currentEmail}`)

        logger.info("Saving account to valid.txt...")
        saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
      }

      await delay(3000)
    } catch (error) {
      logger.error(`Error during verification step: ${error}`)
      await this.page.screenshot({ path: "verification-error.png", fullPage: true })
      logger.info("Verification error screenshot saved")
    }
  }

  async handlePostRegistrationAlerts(): Promise<void> {
    logger.info("Monitoring for post-registration alerts...")

    let flameDialogAccepted = false
    let invitationDialogHandled = false
    let accountSaved = false

    try {
      this.page!.on("dialog", async (dialog) => {
        const message = dialog.message()
        logger.info(`Post-registration alert detected: "${message}"`)

        if (message.includes("Confirm Passing the Flame") || message.includes("Passing the Flame")) {
          flameDialogAccepted = true
          logger.success("Flame dialog detected - account creation successful!")
        }

        if (message.includes("Invitation accepted")) {
          invitationDialogHandled = true
          logger.success("Invitation dialog handled - registration complete!")
        }

        logger.info("Auto-accepting post-registration alert")

        try {
          await dialog.accept()

          if (flameDialogAccepted && invitationDialogHandled && !accountSaved) {
            accountSaved = true
            logger.info("Both success dialogs handled - saving account to valid.txt")
            saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
          }
        } catch (acceptError) {
          logger.warn("Dialog was already handled or closed")
        }

        await delay(2000)
      })

      const alertDelay = this.proxyManager?.getCurrentProxy() ? 15000 : 8000
      logger.info(`Waiting ${alertDelay / 1000}s for post-registration JS alerts...`)
      await delay(alertDelay)

      logger.info("Extra wait for any delayed alerts...")
      await delay(5000)

      if (!accountSaved) {
        logger.info("Checking for successful registration completion...")
        try {
          const currentUrl = this.page!.url()
          if (
            currentUrl.includes("success") ||
            currentUrl.includes("complete") ||
            currentUrl.includes("dashboard") ||
            currentUrl.includes("account")
          ) {
            logger.success("Registration appears successful - saving account to valid.txt")
            saveSuccessfulAccount(this.currentEmail, this.sessionPassword)
            accountSaved = true
          }
        } catch (e) {
          logger.warn("Could not determine registration success from URL")
        }
      }
    } catch (error) {
      logger.info("No post-registration alerts detected")
    }
  }

  private async performDirectConnectionSecurityAudit(): Promise<void> {
    try {
      logger.info("🔍 Performing direct connection security audit...")

      const targetDomain = "act.playcfl.com"
      const targetPort = 443

      // Establish secure connection and get security metrics
      const securityMetrics = await this.secureConnectionManager!.establishSecureConnection(
        targetDomain,
        targetPort,
        {
          useTls: true,
          timeout: 15000
        }
      )

      // Calculate security score based on metrics
      let securityScore = securityMetrics.securityScore
      const vulnerabilities: string[] = []

      // Check for common security issues
      if (securityScore < 70) {
        vulnerabilities.push("Low security score detected")
      }

      if (securityMetrics.certificateInfo && !securityMetrics.certificateInfo.isValid) {
        vulnerabilities.push("Invalid SSL certificate")
      }

      if (securityMetrics.certificateInfo && securityMetrics.certificateInfo.daysUntilExpiry < 30) {
        vulnerabilities.push(`Certificate expires soon (${securityMetrics.certificateInfo.daysUntilExpiry} days)`)
      }

      if (securityMetrics.tlsVersion && !securityMetrics.tlsVersion.includes("1.3")) {
        vulnerabilities.push("Not using latest TLS version")
      }

      if (securityMetrics.networkSecurity && securityMetrics.networkSecurity.riskLevel !== "low") {
        vulnerabilities.push(`Network security risk: ${securityMetrics.networkSecurity.riskLevel}`)
      }

      // Add any existing vulnerabilities from the metrics
      if (securityMetrics.vulnerabilities && securityMetrics.vulnerabilities.length > 0) {
        vulnerabilities.push(...securityMetrics.vulnerabilities)
      }

      // Determine risk level
      let riskLevel: string
      if (securityScore >= 90) riskLevel = "Low"
      else if (securityScore >= 70) riskLevel = "Medium"
      else if (securityScore >= 50) riskLevel = "High"
      else riskLevel = "Critical"

      logger.info(`🔒 Direct Connection Security Audit: Score ${securityScore}/100 (${riskLevel} risk)`)

      if (vulnerabilities.length > 0) {
        logger.warn(`⚠️  Security issues: ${vulnerabilities.join(', ')}`)
      } else {
        logger.success("✅ No security vulnerabilities detected")
      }

      // Log certificate details if available
      if (securityMetrics.certificateInfo) {
        logger.debug(`📜 SSL Certificate: ${securityMetrics.certificateInfo.subject}`)
        logger.debug(`📅 Expires: ${securityMetrics.certificateInfo.validTo.toDateString()}`)
      }

    } catch (error) {
      logger.warn(`⚠️  Direct connection security audit failed: ${error}`)
    }
  }

  async close(): Promise<void> {
    // Clean up quantum proxy manager
    if (this.quantumProxyManager) {
      this.quantumProxyManager.stopKeepAlive()
      await this.quantumProxyManager.cleanup()
    }

    // Note: SecureConnectionManager doesn't have a cleanup method
    // It manages its own lifecycle

    if (this.browser) {
      logger.info("Closing browser...")
      await this.browser.close()
    }
  }

  async run(): Promise<void> {
    try {
      // Step 1: Create temp email
      logger.info("STEP 1: Creating temporary email for this session...")
      const tempEmail = await this.emailService.createTempEmail()

      if (tempEmail) {
        this.currentEmail = tempEmail.email_addr
        logger.info(`Using fresh email: ${this.currentEmail}`)
      }

      // Step 2: Launch browser
      logger.info("STEP 2: Launching fresh browser instance...")
      await this.launchFreshBrowser()

      // Step 3: Registration
      logger.info("STEP 3: Starting registration process...")
      await this.navigateToReferralPage()
      await this.performRegistration()

      const finalDelay = this.proxyManager?.getCurrentProxy() ? 20000 : 10000
      logger.info(`Keeping browser open for ${finalDelay / 1000}s final verification and JS alerts...`)
      await delay(finalDelay)
    } catch (error) {
      logger.error(`Bot execution failed: ${error}`)
      if (this.page) {
        try {
          await this.page.screenshot({ path: "fatal-error.png", fullPage: true })
          logger.info("Fatal error screenshot saved as fatal-error.png")
        } catch (e) {
          logger.warn("Could not save error screenshot")
        }
      }
    } finally {
      await this.close()
      logger.info("Browser cleanup completed - fresh session ready for next run")
    }
  }
}

export default CrossfireReferralBot
