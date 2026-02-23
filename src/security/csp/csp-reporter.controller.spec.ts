import { Test, TestingModule } from '@nestjs/testing';
import { CspReporterController } from '../csp-reporter.controller';

describe('CspReporterController', () => {
  let controller: CspReporterController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CspReporterController],
    }).compile();

    controller = module.get<CspReporterController>(CspReporterController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should handle CSP violation report', () => {
    const report = {
      'csp-report': {
        'document-uri': 'https://example.com/page',
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.com/script.js',
        'source-file': 'https://example.com/page',
        'line-number': 10,
        'column-number': 5,
      },
    };

    controller.handleCspViolation(report);

    const violations = controller.getViolations();
    expect(violations).toHaveLength(1);
    expect(violations[0]['blocked-uri']).toBe('https://evil.com/script.js');
  });

  it('should store multiple violations', () => {
    const report1 = {
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil1.com/script.js',
      },
    };

    const report2 = {
      'csp-report': {
        'violated-directive': 'style-src',
        'blocked-uri': 'https://evil2.com/style.css',
      },
    };

    controller.handleCspViolation(report1);
    controller.handleCspViolation(report2);

    const violations = controller.getViolations();
    expect(violations).toHaveLength(2);
  });

  it('should limit stored violations to max', () => {
    for (let i = 0; i < 1100; i++) {
      controller.handleCspViolation({
        'csp-report': {
          'violated-directive': 'script-src',
          'blocked-uri': `https://evil${i}.com/script.js`,
        },
      });
    }

    const violations = controller.getViolations();
    expect(violations.length).toBeLessThanOrEqual(1000);
  });

  it('should clear violations', () => {
    controller.handleCspViolation({
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.com/script.js',
      },
    });

    expect(controller.getViolations()).toHaveLength(1);

    controller.clearViolations();

    expect(controller.getViolations()).toHaveLength(0);
  });
});
