export const Ping = ({ x, y }: { x: number; y: number }) => {
  return (
    <div
      className="fixed pointer-events-none"
      style={{
        top: y,
        left: x,
        width: 40,
        height: 40,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className="absolute h-full w-full animate-ping bg-base opacity-75"
        style={{ borderRadius: 9999 }}
      ></div>
    </div>
  )
}
