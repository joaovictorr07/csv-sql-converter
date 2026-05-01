import { Injectable, signal } from '@angular/core';
import { LoadingConfig, LoadingState } from '../types/loading';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  state = signal<LoadingState>({
    active: false,
    context: null,
    title: '',
    message: ''
  });

  show(config: LoadingConfig) {
    this.state.set({
      active: true,
      ...config
    });
  }

  hide() {
    this.state.update((current) => ({
      ...current,
      active: false,
      context: null,
      title: '',
      message: ''
    }));
  }

  async track<T>(config: LoadingConfig, task: () => Promise<T>): Promise<T> {
    this.show(config);

    try {
      return await task();
    } finally {
      this.hide();
    }
  }
}
