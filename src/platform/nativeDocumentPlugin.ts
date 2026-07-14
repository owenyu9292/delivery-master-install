import { registerPlugin } from "@capacitor/core";

export interface NativeDocumentSaveResult {
  canceled: boolean;
  uri?: string;
}

export interface NativeDocumentOpenResult {
  canceled: boolean;
  name?: string;
  text?: string;
  uri?: string;
}

export interface DocumentFilePluginContract {
  saveJson(options: { filename: string; text: string }): Promise<NativeDocumentSaveResult>;
  openJson(): Promise<NativeDocumentOpenResult>;
}

export const DocumentFile = registerPlugin<DocumentFilePluginContract>("DocumentFile");
