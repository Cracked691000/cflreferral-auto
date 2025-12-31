import axios, { type AxiosResponse } from "axios"
import { logger } from "../utils/logger"
import { generateHumanUsername } from "../utils/helpers"
import type { TempEmailAccount, GetEmailListResponse } from "../types"

export class EmailService {
  private tempEmailAccount: TempEmailAccount | null = null

  private getRequestHeaders(): Record<string, string> {
    return {
      accept: "*/*",
      "accept-encoding": "gzip, deflate, br, zstd",
      "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://mehmetkahya0.github.io",
      referer: "https://mehmetkahya0.github.io/",
      "sec-ch-ua": '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "user-agent":
        "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36",
    }
  }

  async createTempEmail(): Promise<TempEmailAccount> {
    console.log("📧 Creating temporary email account...")

    const url = "https://api.guerrillamail.com/ajax.php?f=set_email_user"
    const formData = new URLSearchParams()
    formData.append("email_user", generateHumanUsername())
    formData.append("lang", "en")

    try {
      const response: AxiosResponse<any> = await axios.post(url, formData, {
        headers: this.getRequestHeaders(),
        timeout: 10000,
        proxy: undefined,
      })
      const account = response.data

      if (account.email_addr) {
        this.tempEmailAccount = account
        logger.success(`Temp email created: ${account.email_addr}`)
        return account
      } else {
        throw new Error("Failed to create temp email account")
      }
    } catch (error) {
      console.error("❌ Failed to create temp email:", error)
      throw error
    }
  }

  async getVerificationCode(): Promise<string | null> {
    if (!this.tempEmailAccount) {
      console.log("❌ No temp email account available")
      return null
    }

    console.log("📨 Checking for verification email...")

    const params = new URLSearchParams()
    params.append("f", "get_email_list")
    params.append("sid_token", this.tempEmailAccount.sid_token)
    params.append("offset", "0")

    const url = `https://api.guerrillamail.com/ajax.php?${params.toString()}`

    try {
      const response: AxiosResponse<GetEmailListResponse> = await axios.get(url, {
        headers: this.getRequestHeaders(),
        timeout: 10000,
        proxy: undefined,
      })

      if (response.data.list && response.data.list.length > 0) {
        for (const email of response.data.list) {
          if (
            email.mail_from.includes("levelinfinite") ||
            email.mail_subject.toLowerCase().includes("verify") ||
            email.mail_subject.toLowerCase().includes("code") ||
            email.mail_subject.toLowerCase().includes("verification")
          ) {
            console.log(`📧 Found verification email: ${email.mail_subject}`)
            console.log(`📄 Email excerpt: ${email.mail_excerpt}`)

            let codeMatch = email.mail_subject.match(/\b\d{4,8}\b/)
            if (!codeMatch && email.mail_excerpt) {
              codeMatch = email.mail_excerpt.match(/\b\d{4,8}\b/)
            }

            if (codeMatch) {
              const code = codeMatch[0]
              console.log(`🔢 Extracted verification code: ${code}`)
              return code
            } else {
              console.log("⚠️  Could not extract code from email content")
            }
          }
        }
      }

      logger.debug("No verification email found yet, will retry...")
      return null
    } catch (error) {
      console.error("❌ Failed to check emails:", error)
      return null
    }
  }

  getTempEmailAccount(): TempEmailAccount | null {
    return this.tempEmailAccount
  }
}
