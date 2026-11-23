import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc/register";
import { hardenApp } from "./security/harden";
import { createOperatorWindow } from "./windows/operator-window";

app.setName("Church Media");

// One instance only: two copies fighting over the projector is a
// service-stopping failure.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  hardenApp();

  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    await createOperatorWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createOperatorWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
