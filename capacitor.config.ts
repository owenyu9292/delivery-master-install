import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.owenyu9292.deliverymaster',
  appName: '배송마스터',
  webDir: 'dist',
  plugins: {
    // MainActivity owns system-bar and keyboard padding for the whole WebView.
    SystemBars: { insetsHandling: 'disable' }
  }
};

export default config;
