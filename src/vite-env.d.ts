/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** WebSocket address of the shared-reading relay (wss://...). Reading together is hidden without it. */
  readonly VITE_RELAY_URL?: string;
}
