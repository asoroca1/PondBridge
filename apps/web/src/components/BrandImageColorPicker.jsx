import { useEffect, useMemo, useRef, useState } from "react";

function rgbToHex(r = 0, g = 0, b = 0) {
  return `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Number(channel) || 0)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function BrandImageColorPicker({
  value = "",
  onPickColor = () => {},
  className = ""
}) {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [uploadedImageName, setUploadedImageName] = useState("");
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [pickerError, setPickerError] = useState("");

  const activeImageUrl = useMemo(
    () => String(uploadedImageUrl || "").trim(),
    [uploadedImageUrl]
  );

  const canUseSystemDropper = typeof window !== "undefined" && "EyeDropper" in window;

  useEffect(() => {
    setImageLoadFailed(false);
  }, [activeImageUrl]);

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error("No file selected."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Unable to read that image."));
      reader.readAsDataURL(file);
    });
  }

  async function handleUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setPickerError("Please upload an image file.");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setUploadedImageUrl(dataUrl);
      setUploadedImageName(String(file.name || "").trim());
      setImageLoadFailed(false);
      setPickerError("");
      event.target.value = "";
    } catch {
      setPickerError("Unable to read that image.");
    }
  }

  function clearUploadedImage() {
    setUploadedImageUrl("");
    setUploadedImageName("");
    setImageLoadFailed(false);
    setPickerError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function sampleFromRenderedImage(event) {
    const image = imageRef.current;
    if (!image || !activeImageUrl) return;

    const bounds = image.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const x = Math.floor(((event.clientX - bounds.left) / bounds.width) * image.naturalWidth);
    const y = Math.floor(((event.clientY - bounds.top) / bounds.height) * image.naturalHeight);

    try {
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      const canvas = canvasRef.current;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        setPickerError("Unable to sample this image.");
        return;
      }

      context.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
      const pixel = context.getImageData(
        Math.max(0, Math.min(image.naturalWidth - 1, x)),
        Math.max(0, Math.min(image.naturalHeight - 1, y)),
        1,
        1
      ).data;
      const nextHex = rgbToHex(pixel[0], pixel[1], pixel[2]);
      onPickColor(String(nextHex).toLowerCase());
      setPickerError("");
    } catch {
      setPickerError("This image cannot be sampled directly. Upload a local image to pick from it.");
    }
  }

  async function pickFromScreen() {
    if (!canUseSystemDropper) return;
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();
      if (result?.sRGBHex) {
        onPickColor(String(result.sRGBHex).toLowerCase());
        setPickerError("");
      }
    } catch {
      // User canceled or browser blocked it.
    }
  }

  return (
    <div className={classNames("brand-image-picker", className)}>
      <div className="brand-image-picker-head">
        <strong>Pick Color From Image</strong>
        <code>{String(value || "").toUpperCase() || "-"}</code>
      </div>
      <p className="brand-image-picker-copy">
        Upload a logo/photo reference, then click on the image to set your main color.
      </p>
      <div className="brand-image-picker-actions">
        <button
          type="button"
          className="brand-image-picker-btn brand-image-picker-btn-primary"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload Reference
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="brand-image-picker-file-input"
          aria-label="Reference image upload"
        />
        {uploadedImageUrl ? (
          <button
            type="button"
            className="brand-image-picker-btn"
            onClick={clearUploadedImage}
          >
            Clear Reference
          </button>
        ) : null}
        {canUseSystemDropper ? (
          <button type="button" className="brand-image-picker-btn" onClick={pickFromScreen}>
            Screen Dropper
          </button>
        ) : null}
      </div>
      {uploadedImageName ? (
        <p className="brand-image-picker-meta">Using upload: {uploadedImageName}</p>
      ) : null}
      {activeImageUrl && !imageLoadFailed ? (
        <div className="brand-image-picker-preview">
          <img
            ref={imageRef}
            src={activeImageUrl}
            alt="Color sampling source"
            className="brand-image-picker-preview-image"
            onClick={sampleFromRenderedImage}
            onLoad={() => {
              setImageLoadFailed(false);
              if (pickerError.includes("could not be loaded")) setPickerError("");
            }}
            onError={() => {
              setImageLoadFailed(true);
              setPickerError("Uploaded image preview failed. Please try a different image.");
            }}
          />
        </div>
      ) : (
        <div className="brand-image-picker-empty">
          Upload a reference image to sample colors.
        </div>
      )}
      {pickerError ? <p className="brand-image-picker-error">{pickerError}</p> : null}
    </div>
  );
}
