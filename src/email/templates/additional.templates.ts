import { EmailTemplate } from './welcome.template';

export const securityAlertTemplate: EmailTemplate = {
  subject: 'Security Alert: {{alertType}}',
  html: `
    <h1>Security Alert</h1>
    <p><strong>Alert Type:</strong> {{alertType}}</p>
    <p><strong>Description:</strong> {{description}}</p>
    <p><strong>Time:</strong> {{timestamp}}</p>
    <p><strong>IP Address:</strong> {{ipAddress}}</p>
    <p>If this wasn't you, please secure your account immediately.</p>
    <a href="{{link}}">Review Security Settings</a>
  `,
  variables: ['alertType', 'description', 'timestamp', 'ipAddress', 'link'],
};

export const signalPerformanceTemplate: EmailTemplate = {
  subject: 'Signal Performance Alert: {{signalName}}',
  html: `
    <h1>Signal Performance Alert</h1>
    <p>Your signal <strong>{{signalName}}</strong> has triggered a performance alert.</p>
    <p><strong>Performance:</strong> {{performance}}</p>
    <p><strong>Threshold:</strong> {{threshold}}</p>
    <p><strong>Recommendation:</strong> {{recommendation}}</p>
    <a href="{{link}}">View Signal Details</a>
  `,
  variables: ['signalName', 'performance', 'threshold', 'recommendation', 'link'],
};

export const weeklySummaryTemplate: EmailTemplate = {
  subject: 'Your Weekly Summary',
  html: `
    <h1>Weekly Summary</h1>
    <p>Hi {{name}},</p>
    <p>Here's your activity summary for the week:</p>
    <ul>
      <li><strong>Total Trades:</strong> {{totalTrades}}</li>
      <li><strong>Total Volume:</strong> {{totalVolume}}</li>
      <li><strong>Profit/Loss:</strong> {{profitLoss}}</li>
      <li><strong>Active Signals:</strong> {{activeSignals}}</li>
    </ul>
    <a href="{{link}}">View Full Report</a>
  `,
  variables: ['name', 'totalTrades', 'totalVolume', 'profitLoss', 'activeSignals', 'link'],
};

export const passwordResetTemplate: EmailTemplate = {
  subject: 'Password Reset Request',
  html: `
    <h1>Password Reset Request</h1>
    <p>Hi {{name}},</p>
    <p>You requested to reset your password. Please click the link below to set a new password:</p>
    <a href="{{link}}">Reset Password</a>
    <p>This link will expire in 1 hour.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
  `,
  variables: ['name', 'link'],
};
