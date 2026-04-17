import { useContext, useCallback, useEffect, useRef, useState } from "react";
import { ViewerContext } from "../features/vrmViewer/viewerContext";
import { buildUrl } from "@/utils/buildUrl";
import { Ping } from "./ping";

type Props = {
  onTap?: () => void;
  disabled?: boolean;
};

export default function VrmViewer({ onTap, disabled }: Props) {
  const { viewer } = useContext(ViewerContext);
  const [pingPos, setPingPos] = useState<{ x: number; y: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (canvas) {
        viewer.setup(canvas);
        viewer.loadVrm(buildUrl("/cococo.vrm"));

        // Drag and DropでVRMを差し替え
        canvas.addEventListener("dragover", function (event) {
          event.preventDefault();
        });

        canvas.addEventListener("drop", function (event) {
          event.preventDefault();

          const files = event.dataTransfer?.files;
          if (!files) {
            return;
          }

          const file = files[0];
          if (!file) {
            return;
          }

          const file_type = file.name.split(".").pop();
          if (file_type === "vrm") {
            const blob = new Blob([file], { type: "application/octet-stream" });
            const url = window.URL.createObjectURL(blob);
            viewer.loadVrm(url);
          }
        });
      }
    },
    [viewer]
  );

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      setPingPos({ x: e.clientX, y: e.clientY });
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setPingPos(null), 1000);
      onTap?.();
    },
    [onTap, disabled]
  );

  return (
    <div
      className={"absolute top-0 left-0 w-screen h-[100svh] -z-10"}
      onPointerDown={handlePointerDown}
    >
      {pingPos && <Ping x={pingPos.x} y={pingPos.y} />}
      <canvas ref={canvasRef} className={"h-full w-full"}></canvas>
    </div>
  );
}
