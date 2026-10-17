// Six-petal emblem. Swap the <g> for the final artwork from flortodas.html when ready.
export default function DivinaMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" role="img" aria-label="Divina emblem" fill="none" stroke="#d6c3a1" strokeWidth="1.6">
      <g>
        {[0, 60, 120, 180, 240, 300].map((a) => (
          <path key={a} transform={`rotate(${a})`} d="M0 -6 C 14 -22, 14 -40, 0 -46 C -14 -40, -14 -22, 0 -6 Z" />
        ))}
        <circle r="5" fill="#d6c3a1" stroke="none" />
      </g>
    </svg>
  );
}
