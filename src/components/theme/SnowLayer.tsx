interface SnowLayerProps {
  active: boolean;
}

export function SnowLayer({ active }: SnowLayerProps) {
  if (!active) return null;

  return (
    <div className="antarctic-snow-layer" aria-hidden="true">
      <div className="antarctic-snow-layer__field" />
    </div>
  );
}
