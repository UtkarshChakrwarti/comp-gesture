/*
 * @name: gest.js
 * @description: A lightweight, webcam-based gesture recognition library for immersive web applications.
 * @version: 1.0.0
 * @author: Your Name
 * @license: MIT License
 */

window.gest = (function (window) {
    "use strict";

    // Constants
    const DEFAULT_SETTINGS = {
        framerate: 25,
        videoCompressionRate: 4,
        sensitivity: 80, // Range: 0 to 100 (100 => very sensitive)
        skinFilter: true,
        debug: {
            enabled: false,
            canvas: null,
            context: null
        }
    };

    // State Management
    let isInitialized = false;
    let isRunning = false;
    let mediaStream = null;
    let videoElement, canvasElement, canvasContext;

    // Gesture Recognition State
    let priorFrame = null;
    let gestureState = {
        filteringFactor: 0.9,
        minTotalChange: 300, // Minimum pixels changed to detect a gesture
        minDirChange: 2, // Minimum pixels for directional change
        longDirChange: 7, // Minimum pixels for long directional change
        state: 0 // 0: Waiting, 1: Gesture detected, 2: Gesture ended
    };

    // Utility Functions
    const utils = {
        addEventListener: (event, element, handler) => element.addEventListener(event, handler),
        removeEventListener: (event, element, handler) => element.removeEventListener(event, handler),
        createCustomEvent: (eventName, detail) => new CustomEvent(eventName, { detail }),
        fireEvent: (element, event) => element.dispatchEvent(event)
    };

    // Skin Detection using HSV
    const skinFilter = {
        hueRange: [0.0, 0.1], // Hue range for skin tones
        saturationRange: [0.3, 1.0], // Saturation range
        valueRange: [0.4, 1.0], // Brightness range

        rgbToHsv: (r, g, b) => {
            r /= 255; g /= 255; b /= 255;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            let h, s, v = max;
            const d = max - min;
            s = max === 0 ? 0 : d / max;
            if (max === min) h = 0;
            else {
                switch (max) {
                    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                    case g: h = (b - r) / d + 2; break;
                    case b: h = (r - g) / d + 4; break;
                }
                h /= 6;
            }
            return [h, s, v];
        },

        apply: (frame) => {
            const data = frame.data;
            for (let i = 0; i < data.length; i += 4) {
                const [h, s, v] = skinFilter.rgbToHsv(data[i], data[i + 1], data[i + 2]);
                if (!(h >= skinFilter.hueRange[0] && h <= skinFilter.hueRange[1] &&
                      s >= skinFilter.saturationRange[0] && s <= skinFilter.saturationRange[1] &&
                      v >= skinFilter.valueRange[0] && v <= skinFilter.valueRange[1])) {
                    data[i] = data[i + 1] = data[i + 2] = 255; // Non-skin pixels to white
                    data[i + 3] = 0; // Transparent
                }
            }
            return frame;
        }
    };

    // Frame Difference Calculation
    const differenceMap = {
        get: (currentFrame, sensitivity) => {
            const delt = canvasContext.createImageData(currentFrame.width, currentFrame.height);
            let totalChangedPixels = 0, totalX = 0, totalY = 0;

            if (priorFrame) {
                const maxChange = 256 * 3 * (1 - sensitivity / 100);
                for (let i = 0; i < currentFrame.data.length; i += 4) {
                    const d = Math.abs(currentFrame.data[i] - priorFrame.data[i]) +
                              Math.abs(currentFrame.data[i + 1] - priorFrame.data[i + 1]) +
                              Math.abs(currentFrame.data[i + 2] - priorFrame.data[i + 2]);
                    if (d > maxChange) {
                        delt.data[i] = 255; delt.data[i + 1] = 0; delt.data[i + 2] = 0; delt.data[i + 3] = 255;
                        totalChangedPixels++;
                        totalX += (i / 4) % currentFrame.width;
                        totalY += Math.floor((i / 4) / currentFrame.height);
                    } else {
                        delt.data[i] = delt.data[i + 1] = delt.data[i + 2] = delt.data[i + 3] = 0;
                    }
                }
            }

            if (totalChangedPixels > 0) {
                detectGesture({ x: totalX / totalChangedPixels, y: totalY / totalChangedPixels, d: totalChangedPixels });
            }

            priorFrame = currentFrame;
            return delt;
        }
    };

    // Gesture Detection Logic
    const detectGesture = (movement) => {
        const { x, y, d } = movement;
        const dx = x - (gestureState.priorX || x);
        const dy = y - (gestureState.priorY || y);

        if (d > gestureState.minTotalChange) {
            if (Math.abs(dx) > gestureState.minDirChange) {
                utils.fireEvent(document, utils.createCustomEvent('gest', { direction: dx > 0 ? 'Left' : 'Right' }));
            }
            if (Math.abs(dy) > gestureState.minDirChange) {
                utils.fireEvent(document, utils.createCustomEvent('gest', { direction: dy > 0 ? 'Down' : 'Up' }));
            }
        }

        gestureState.priorX = x;
        gestureState.priorY = y;
    };

    // Initialize Library
    const init = () => {
        if (isInitialized) return true;

        videoElement = document.createElement('video');
        canvasElement = document.createElement('canvas');
        canvasContext = canvasElement.getContext('2d');

        if (!videoElement.canPlayType || !canvasContext || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Browser does not support required features.');
        }

        document.body.appendChild(videoElement);
        document.body.appendChild(canvasElement);
        isInitialized = true;
        return true;
    };

    // Start Gesture Recognition
    const start = () => {
        if (!isInitialized || isRunning) return false;

        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                mediaStream = stream;
                videoElement.srcObject = stream;
                videoElement.play();

                const processFrame = () => {
                    const width = videoElement.videoWidth / DEFAULT_SETTINGS.videoCompressionRate;
                    const height = videoElement.videoHeight / DEFAULT_SETTINGS.videoCompressionRate;
                    canvasContext.drawImage(videoElement, 0, 0, width, height);
                    const frame = canvasContext.getImageData(0, 0, width, height);
                    const processedFrame = DEFAULT_SETTINGS.skinFilter ? skinFilter.apply(frame) : frame;
                    differenceMap.get(processedFrame, DEFAULT_SETTINGS.sensitivity);
                    if (isRunning) requestAnimationFrame(processFrame);
                };

                isRunning = true;
                processFrame();
            })
            .catch(error => {
                console.error('Error accessing webcam:', error);
            });

        return true;
    };

    // Stop Gesture Recognition
    const stop = () => {
        if (!isRunning) return false;
        isRunning = false;
        mediaStream.getTracks().forEach(track => track.stop());
        return true;
    };

    // Public API
    return {
        init,
        start,
        stop,
        options: {
            setSensitivity: (value) => DEFAULT_SETTINGS.sensitivity = Math.max(0, Math.min(100, value)),
            enableDebug: (enabled) => DEFAULT_SETTINGS.debug.enabled = enabled,
            enableSkinFilter: (enabled) => DEFAULT_SETTINGS.skinFilter = enabled
        }
    };
}(window));
