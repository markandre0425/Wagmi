import './App.css';

// Landing page = WW-Dash (full viewport). Dev: /dashboard/ (proxied to WW-Dash on 5174); prod: /dashboard/ or dashboard/index.html (Electron)
const dashboardSrc =
  import.meta.env.BASE_URL === './'
    ? 'dashboard/index.html'
    : '/dashboard/';

function App() {
  return (
    <div className="landing-ww-dash">
      <iframe
        className="landing-iframe"
        src={dashboardSrc}
        title="Wealth Wards Dashboard"
      />
    </div>
  );
}

export default App;
