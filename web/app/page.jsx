export default function Home() {
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif', color: '#fff', background: '#0b0f1a',
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: 24,
    }}>
      <div>
        <h1>Blob Battle</h1>
        <p>L'overlay OBS se trouve sur <code>/overlay</code>.</p>
      </div>
    </div>
  );
}
