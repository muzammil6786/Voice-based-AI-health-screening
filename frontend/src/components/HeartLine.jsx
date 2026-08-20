export default function HeartLine({ active }) {
  return (
    <svg
      className={`heartline${active ? " active" : ""}`}
      viewBox="0 0 300 34"
      preserveAspectRatio="none"
    >
      <path
        d="M0,17 L100,17 L112,4 L124,30 L136,10 L148,24 L160,17 L300,17"
        style={{
          strokeDasharray: 420,
          strokeDashoffset: active ? 0 : 420,
          transition: "stroke-dashoffset 1.1s ease-in-out",
        }}
      />
    </svg>
  );
}
