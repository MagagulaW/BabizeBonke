export function AppSplash({ message = "Loading your delivery experience..." }: { message?: string }) {
  return (
    <div className="app-splash-screen">
      <div className="app-splash-card">
        <img src="/jstart-logo.png" alt="JStart Food Delivery" className="app-splash-logo" />
        <div className="app-splash-bar"><span /></div>
        <div className="app-splash-text">{message}</div>
      </div>
    </div>
  );
}
