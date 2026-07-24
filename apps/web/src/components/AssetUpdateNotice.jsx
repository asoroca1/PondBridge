import { useEffect, useState } from "react";
import {
  CHUNK_UPDATE_EVENT,
  dismissChunkUpdateNotice,
  loadLatestBuild,
  readChunkUpdateNotice
} from "../lib/chunkRecovery.js";

export function AssetUpdateNotice() {
  const [notice, setNotice] = useState(() => readChunkUpdateNotice());

  useEffect(() => {
    const handleUpdateRequired = (event) => {
      setNotice(event?.detail || readChunkUpdateNotice() || { detectedAt: Date.now() });
    };
    window.addEventListener(CHUNK_UPDATE_EVENT, handleUpdateRequired);
    return () => window.removeEventListener(CHUNK_UPDATE_EVENT, handleUpdateRequired);
  }, []);

  if (!notice) return null;

  const keepWorking = () => {
    dismissChunkUpdateNotice();
    setNotice(null);
  };

  return (
    <aside className="asset-update-notice" role="region" aria-label="PondBridge update">
      <div>
        <strong>A PondBridge update is ready</strong>
        <span aria-live="polite">Your current screen will stay open. Update when you are ready.</span>
      </div>
      <div className="asset-update-actions">
        <button type="button" className="btn btn-primary" onClick={loadLatestBuild}>
          Update now
        </button>
        <button type="button" className="btn btn-ghost" onClick={keepWorking}>
          Keep working
        </button>
      </div>
    </aside>
  );
}
