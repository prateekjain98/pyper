import { useEffect, useState } from "react";

// Wispr-style drag-to-reposition overlay. Rendered in its own full-screen,
// transparent, click-through window (?drag-overlay=true) that covers the display
// the dictation pill is on. The main process drives it live from the drag loop:
// each `update` carries the five snap targets (in this window's CSS pixels), the
// cursor, and which target is currently nearest; `hide` fades it out on drop.
//
// This window never captures the pointer (pointer-events: none + the window's own
// setIgnoreMouseEvents), so the drag gesture stays owned by the pill window.

type Marker = { id: string; x: number; y: number; active: boolean };
type OverlayPayload = {
  markers: Marker[];
  cursor: { x: number; y: number };
  activeId: string;
};

const MARKER_SIZE = 66;

export default function DragOverlay() {
  const [visible, setVisible] = useState(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const offUpdate = window.electronAPI?.onDragOverlayUpdate?.((payload: OverlayPayload) => {
      setMarkers(Array.isArray(payload?.markers) ? payload.markers : []);
      setCursor(payload?.cursor ?? null);
      setVisible(true);
    });
    const offHide = window.electronAPI?.onDragOverlayHide?.(() => {
      setVisible(false);
    });
    return () => {
      offUpdate?.();
      offHide?.();
    };
  }, []);

  return (
    <div
      className="drag-overlay-window"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 180ms ease-out",
        // Dim the whole display behind the pill. The pill window floats above
        // this scrim, so it stays bright and visibly draggable.
        background:
          "radial-gradient(120% 120% at 50% 45%, rgba(6,8,18,0.30) 0%, rgba(6,8,18,0.42) 100%)",
      }}
    >
      {/* A soft glow that tracks the cursor, reinforcing the live feel. */}
      {cursor && (
        <div
          style={{
            position: "absolute",
            left: cursor.x,
            top: cursor.y,
            width: 260,
            height: 260,
            transform: "translate(-50%, -50%)",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(96,165,250,0.16) 0%, rgba(96,165,250,0) 70%)",
            pointerEvents: "none",
          }}
        />
      )}

      {markers.map((marker) => (
        <div
          key={marker.id}
          style={{
            position: "absolute",
            left: marker.x,
            top: marker.y,
            width: MARKER_SIZE,
            height: MARKER_SIZE,
            transform: `translate(-50%, -50%) scale(${marker.active ? 1.12 : 1})`,
            borderRadius: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            border: marker.active
              ? "2px solid rgba(191,219,254,0.95)"
              : "1.5px dashed rgba(255,255,255,0.42)",
            background: marker.active ? "rgba(59,130,246,0.30)" : "rgba(255,255,255,0.07)",
            boxShadow: marker.active
              ? "0 0 0 5px rgba(59,130,246,0.22), 0 10px 32px rgba(0,0,0,0.38)"
              : "0 2px 10px rgba(0,0,0,0.18)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            transition:
              "transform 150ms cubic-bezier(0.34,1.56,0.64,1), background 150ms ease-out, border-color 150ms ease-out, box-shadow 150ms ease-out",
            pointerEvents: "none",
          }}
        >
          {/* Ghost orb previews where the pill will land on the active target. */}
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: marker.active
                ? "radial-gradient(circle at 35% 30%, #ffffff 0%, #93c5fd 40%, #3b82f6 100%)"
                : "rgba(255,255,255,0.5)",
              boxShadow: marker.active ? "0 0 14px rgba(96,165,250,0.85)" : "none",
              opacity: marker.active ? 1 : 0.55,
              transform: `scale(${marker.active ? 1 : 0.7})`,
              transition: "transform 150ms ease-out, opacity 150ms ease-out, box-shadow 150ms ease-out",
            }}
          />
        </div>
      ))}
    </div>
  );
}
