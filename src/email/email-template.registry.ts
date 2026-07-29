import { Injectable, OnModuleInit } from '@nestjs/common';
import { TemplateEngineService } from './template-engine.service';

/**
 * Registers all email templates for supported locales on startup.
 * Add new templates here; the engine handles locale fallback to 'en'.
 */
@Injectable()
export class EmailTemplateRegistry implements OnModuleInit {
  constructor(private readonly engine: TemplateEngineService) {}

  onModuleInit(): void {
    this.registerEnTemplates();
    this.registerEsTemplates();
    this.registerFrTemplates();
  }

  private registerEnTemplates(): void {
    this.engine.register('welcome', 'en', {
      subject: 'Welcome to StellarSwipe, {{name}}!',
      html: `
        <h1>Welcome to StellarSwipe!</h1>
        <p>Hi {{name}},</p>
        <p>Thank you for joining StellarSwipe. We're excited to have you on board!</p>
        <p>Get started by exploring our platform and setting up your first trade.</p>
        <a href="{{link}}">Go to Dashboard</a>
      `,
      variables: ['name', 'link'],
    });

    this.engine.register('trade-executed', 'en', {
      subject: 'Trade Executed: {{baseAsset}}/{{counterAsset}}',
      html: `
        <h2>Trade Executed</h2>
        <p>Hi {{name}},</p>
        <p>Your trade has been executed successfully.</p>
        <ul>
          <li>Pair: {{baseAsset}}/{{counterAsset}}</li>
          <li>Type: {{tradeType}}</li>
          <li>Amount: {{formatAmount amount}}</li>
          <li>Price: {{entryPrice}}</li>
          <li>Date: {{formatDate executedAt}}</li>
        </ul>
        <a href="{{link}}">View Trade</a>
      `,
      variables: ['name', 'baseAsset', 'counterAsset', 'tradeType', 'amount', 'entryPrice', 'executedAt', 'link'],
    });

    this.engine.register('payout-completed', 'en', {
      subject: 'Payout of {{formatAmount amount}} Completed',
      html: `
        <h2>Payout Completed</h2>
        <p>Hi {{name}},</p>
        <p>Your payout of {{formatAmount amount}} has been processed.</p>
        <p>Transaction ID: {{transactionId}}</p>
        <a href="{{link}}">View Details</a>
      `,
      variables: ['name', 'amount', 'transactionId', 'link'],
    });

    this.engine.register('security-alert', 'en', {
      subject: 'Security Alert: {{alertType}}',
      html: `
        <h2>Security Alert</h2>
        <p>Hi {{name}},</p>
        <p>We detected a security event on your account: <strong>{{alertType}}</strong></p>
        <p>Time: {{formatDate occurredAt}}</p>
        <p>If this wasn't you, please secure your account immediately.</p>
        <a href="{{link}}">Secure Account</a>
      `,
      variables: ['name', 'alertType', 'occurredAt', 'link'],
    });

    this.engine.register('signal-performance', 'en', {
      subject: 'Signal Performance Update',
      html: `
        <h2>Signal Performance</h2>
        <p>Hi {{name}},</p>
        <p>Here's your signal performance summary:</p>
        <ul>
          <li>Win Rate: {{winRate}}%</li>
          <li>Total PnL: {{formatAmount totalPnl}}</li>
          <li>Signals: {{signalCount}}</li>
        </ul>
        <a href="{{link}}">View Full Report</a>
      `,
      variables: ['name', 'winRate', 'totalPnl', 'signalCount', 'link'],
    });

    this.engine.register('weekly-summary', 'en', {
      subject: 'Your Weekly StellarSwipe Summary',
      html: `
        <h2>Weekly Summary</h2>
        <p>Hi {{name}},</p>
        <p>Here's what happened this week:</p>
        <ul>
          <li>Trades: {{tradeCount}}</li>
          <li>PnL: {{formatAmount weeklyPnl}}</li>
          <li>Top Signal: {{topSignal}}</li>
        </ul>
        <a href="{{link}}">View Dashboard</a>
      `,
      variables: ['name', 'tradeCount', 'weeklyPnl', 'topSignal', 'link'],
    });

    this.engine.register('contest-result', 'en', {
      subject: 'Contest Results: {{contestName}}',
      html: `
        <h2>Contest Results</h2>
        <p>Hi {{name}},</p>
        <p>The contest <strong>{{contestName}}</strong> has ended.</p>
        {{#if isWinner}}
          <p>Congratulations! You placed #{{rank}} and won {{formatAmount prize}}!</p>
        {{else}}
          <p>You placed #{{rank}}. Better luck next time!</p>
        {{/if}}
        <a href="{{link}}">View Leaderboard</a>
      `,
      variables: ['name', 'contestName', 'rank', 'isWinner', 'prize', 'link'],
    });
  }

  private registerEsTemplates(): void {
    this.engine.register('welcome', 'es', {
      subject: '¡Bienvenido a StellarSwipe, {{name}}!',
      html: `
        <h1>¡Bienvenido a StellarSwipe!</h1>
        <p>Hola {{name}},</p>
        <p>Gracias por unirte a StellarSwipe. ¡Estamos emocionados de tenerte!</p>
        <a href="{{link}}">Ir al Panel</a>
      `,
      variables: ['name', 'link'],
    });

    this.engine.register('trade-executed', 'es', {
      subject: 'Operación Ejecutada: {{baseAsset}}/{{counterAsset}}',
      html: `
        <h2>Operación Ejecutada</h2>
        <p>Hola {{name}},</p>
        <p>Tu operación se ejecutó correctamente.</p>
        <ul>
          <li>Par: {{baseAsset}}/{{counterAsset}}</li>
          <li>Tipo: {{tradeType}}</li>
          <li>Monto: {{formatAmount amount}}</li>
          <li>Precio: {{entryPrice}}</li>
          <li>Fecha: {{formatDate executedAt}}</li>
        </ul>
        <a href="{{link}}">Ver Operación</a>
      `,
      variables: ['name', 'baseAsset', 'counterAsset', 'tradeType', 'amount', 'entryPrice', 'executedAt', 'link'],
    });

    this.engine.register('security-alert', 'es', {
      subject: 'Alerta de Seguridad: {{alertType}}',
      html: `
        <h2>Alerta de Seguridad</h2>
        <p>Hola {{name}},</p>
        <p>Detectamos un evento de seguridad: <strong>{{alertType}}</strong></p>
        <p>Si no fuiste tú, asegura tu cuenta de inmediato.</p>
        <a href="{{link}}">Asegurar Cuenta</a>
      `,
      variables: ['name', 'alertType', 'occurredAt', 'link'],
    });
  }

  private registerFrTemplates(): void {
    this.engine.register('welcome', 'fr', {
      subject: 'Bienvenue sur StellarSwipe, {{name}} !',
      html: `
        <h1>Bienvenue sur StellarSwipe !</h1>
        <p>Bonjour {{name}},</p>
        <p>Merci de rejoindre StellarSwipe. Nous sommes ravis de vous accueillir !</p>
        <a href="{{link}}">Aller au Tableau de Bord</a>
      `,
      variables: ['name', 'link'],
    });

    this.engine.register('trade-executed', 'fr', {
      subject: 'Transaction Exécutée : {{baseAsset}}/{{counterAsset}}',
      html: `
        <h2>Transaction Exécutée</h2>
        <p>Bonjour {{name}},</p>
        <p>Votre transaction a été exécutée avec succès.</p>
        <ul>
          <li>Paire : {{baseAsset}}/{{counterAsset}}</li>
          <li>Type : {{tradeType}}</li>
          <li>Montant : {{formatAmount amount}}</li>
          <li>Prix : {{entryPrice}}</li>
          <li>Date : {{formatDate executedAt}}</li>
        </ul>
        <a href="{{link}}">Voir la Transaction</a>
      `,
      variables: ['name', 'baseAsset', 'counterAsset', 'tradeType', 'amount', 'entryPrice', 'executedAt', 'link'],
    });

    this.engine.register('security-alert', 'fr', {
      subject: 'Alerte de Sécurité : {{alertType}}',
      html: `
        <h2>Alerte de Sécurité</h2>
        <p>Bonjour {{name}},</p>
        <p>Nous avons détecté un événement de sécurité : <strong>{{alertType}}</strong></p>
        <p>Si ce n'était pas vous, sécurisez votre compte immédiatement.</p>
        <a href="{{link}}">Sécuriser le Compte</a>
      `,
      variables: ['name', 'alertType', 'occurredAt', 'link'],
    });
  }
}
