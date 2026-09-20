import nodemailer from 'nodemailer';
import dns from 'dns';

// Force IPv4 resolution to prevent ENETUNREACH on IPv6 networks
dns.setDefaultResultOrder('ipv4first');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export const emailService = {
  async sendResetOtp(email: string, otp: string, role: string) {
    try {
      const scheme = role === 'customer' ? 'teksysagromarket' : 'teksysagro';
      const deepLinkUrl = `${scheme}://reset-password?email=${encodeURIComponent(email)}&otp=${otp}`;
      
      const mailOptions = {
        from: `"Teksys Agro" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #2e7d32; text-align: center;">Password Reset Request</h2>
            <p>You recently requested to reset your password for your Teksys Agro account.</p>
            <p>To reset your password, click the button below. This link will safely open the app and take you to the reset screen.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${deepLinkUrl}" style="background-color: #1a00cc; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">Reset Password</a>
            </div>
            <p style="margin-top: 20px;">Or enter this verification code manually in the app:</p>
            <p style="text-align: center;"><strong><span style="font-size: 24px; letter-spacing: 4px; background: #f5f5f5; padding: 10px 20px; border-radius: 8px;">${otp}</span></strong></p>
            <p style="font-size: 13px; color: #666; margin-top: 30px; text-align: center;">This link and code will expire in 15 minutes.</p>
            <p style="font-size: 12px; color: #999; margin-top: 20px; text-align: center;">If you did not request a password reset, please ignore this email.</p>
          </div>
        `
      };

      const info = await transporter.sendMail(mailOptions);
      console.log('Message sent: %s', info.messageId);
      return true;
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send email. Please try again later.');
    }
  }
};
