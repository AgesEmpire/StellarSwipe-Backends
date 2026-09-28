# StellarSwipe Developer Documentation

Welcome to the StellarSwipe developer documentation! This guide will help you integrate with our copy trading platform on Stellar.

## Quick Links

- [Quick Start Guide](./guides/quickstart.md) - Get started in minutes
- [API Reference](./api-reference/openapi.yaml) - Complete API documentation
- [TypeScript SDK](../sdk/typescript/README.md) - Official SDK

## Getting Started

### 1. Get Your API Key

1. Sign up at [StellarSwipe](https://app.stellarswipe.com)
2. Navigate to [Developer Dashboard](https://app.stellarswipe.com/developer)
3. Create an API key

### 2. Install the SDK

```bash
npm install @stellarswipe/sdk
```

### 3. Make Your First Request

```typescript
import { StellarSwipeClient } from '@stellarswipe/sdk';

const client = new StellarSwipeClient('your-api-key');

const signals = await client.signals.list({ limit: 10 });
console.log(`Found ${signals.signals.length} signals`);
```

## Documentation

### Guides

- [Quick Start](./guides/quickstart.md) - Get started with StellarSwipe API
- [Authentication](./guides/authentication.md) - Secure API key management
- [Webhooks](./guides/webhooks.md) - Real-time event notifications
- [Best Practices](./guides/best-practices.md) - Production-ready patterns
- [Rate Limiting & Abuse Protection](./RATE_LIMITING.md) - Tiers, configuration, and 429 retry guidance

### Examples

- [Trading Bot Guide](./examples/trading-bot-guide.md) - Build an automated trading bot
- [Portfolio Management](./examples/portfolio-management.md) - Automated portfolio rebalancing

### API Reference

- [OpenAPI Specification](./api-reference/openapi.yaml) - Complete API documentation
- Interactive documentation available at [api.stellarswipe.com/docs](https://api.stellarswipe.com/docs)

## SDK Documentation

### TypeScript/JavaScript

- [SDK README](../sdk/typescript/README.md)
- [npm package](https://www.npmjs.com/package/@stellarswipe/sdk)

### Python (Coming Soon)

Python SDK is under development.

## Core Concepts

### Signals

Trading signals are recommendations from experienced traders on the platform. Each signal includes:

- Asset pair (e.g., USDC/XLM)
- Action (BUY or SELL)
- Entry price
- Target price and stop loss (optional)
- Confidence level (0-100)
- Reasoning

### Trades

Trades are executed based on signals. The API allows you to:

- Execute trades (copy a signal)
- Validate trades before execution
- Close positions
- Partially close positions
- Track performance

### Portfolio

Manage your portfolio with features like:

- Real-time portfolio value and performance
- Position tracking
- Trade history
- Automated rebalancing
- Risk management

## Features

### ✅ Trade Execution

Execute trades based on signals from top providers with automatic validation and risk checks.

### ✅ Portfolio Management

Track your portfolio performance, manage positions, and implement automated rebalancing strategies.

### ✅ Real-time Updates

Subscribe to webhooks for real-time notifications about signals, trades, and portfolio changes.

### ✅ Risk Management

Built-in risk management features including position limits, stop-loss, and take-profit automation.

### ✅ Performance Analytics

Comprehensive analytics including win rate, ROI, P&L tracking, and performance metrics.

## Rate Limits

- Tiered limits by route: 100 req/15 min for public endpoints, 1000 req/15 min for
  authenticated endpoints, 10 req/min for trade execution — see
  [Rate Limiting & Abuse Protection](./RATE_LIMITING.md) for the full breakdown and how to
  configure limits per environment.
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers included in
  every response
- `429` responses include a `Retry-After` header and retry guidance in the response body
- Automatic retry handling in SDK

## Support

### Documentation

- [Full Documentation](https://docs.stellarswipe.com)
- [API Reference](https://api.stellarswipe.com/docs)
- [SDK Examples](../sdk/typescript/examples/)

### Community

- [Discord](https://discord.gg/stellarswipe)
- [GitHub Discussions](https://github.com/stellarswipe/sdk/discussions)
- [Twitter](https://twitter.com/stellarswipe)

### Direct Support

- Email: support@stellarswipe.com
- Developer Support: developers@stellarswipe.com

## Contributing

We welcome contributions! Please see our contributing guidelines:

- [SDK Contributing Guide](../sdk/typescript/CONTRIBUTING.md)
- [Documentation Issues](https://github.com/stellarswipe/docs/issues)

## License

The StellarSwipe SDK is MIT licensed. See [LICENSE](../sdk/typescript/LICENSE) for details.

## Next Steps

- 📖 Read the [Quick Start Guide](./guides/quickstart.md)
- 🔧 Check out [Code Examples](./examples/)
- 💬 Join our [Discord Community](https://discord.gg/stellarswipe)
- 🚀 Start building!
