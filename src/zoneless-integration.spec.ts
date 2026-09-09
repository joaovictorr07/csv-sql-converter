import '@angular/compiler';
import {
  ChangeDetectionStrategy,
  Component,
  createComponent,
  provideZonelessChangeDetection,
  signal
} from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

@Component({
  selector: 'app-zoneless-test-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<span data-testid="status">{{ status() }}</span>'
})
class ZonelessTestHostComponent {
  readonly status = signal('pending');

  completeAsync(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(() => {
        this.status.set('complete');
        resolve();
      });
    });
  }
}

describe('zoneless integration', () => {
  it('updates an OnPush view after an asynchronous signal notification without Zone.js', async () => {
    expect('Zone' in globalThis).toBe(false);

    const application = await createApplication({
      providers: [provideZonelessChangeDetection()]
    });
    const host = document.createElement('div');
    const component = createComponent(ZonelessTestHostComponent, {
      environmentInjector: application.injector,
      hostElement: host
    });

    application.attachView(component.hostView);
    await application.whenStable();
    expect(host.textContent).toContain('pending');

    await component.instance.completeAsync();
    await application.whenStable();
    expect(host.textContent).toContain('complete');

    application.detachView(component.hostView);
    component.destroy();
    application.destroy();
  });
});
