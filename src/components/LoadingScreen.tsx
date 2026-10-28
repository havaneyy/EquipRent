export function LoadingScreen() {
  return (
    <main className="loading-screen" role="status" aria-label="Loading" aria-busy="true">
      <div className="loading-screen-card">
        <div className="loading-screen-spinner" aria-hidden="true" />
        <div className="loading-screen-brand">
          <span className="brand-name">Equip<span>Rent</span></span>
        </div>
      </div>
    </main>
  );
}
