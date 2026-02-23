export default function ProductFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="product-footer">
      <div className="product-footer-inner">
        <section className="product-footer-col">
          <h3>PondBridge</h3>
          <p>A modern alumni network platform built for camp communities.</p>
        </section>

        <section className="product-footer-col">
          <h4>Product</h4>
          <a href="https://pondbridge.co/security" target="_blank" rel="noreferrer">
            Security
          </a>
          <a href="mailto:support@pondbridge.co?subject=PondBridge%20Support">
            Support
          </a>
          <a href="https://status.pondbridge.co" target="_blank" rel="noreferrer">
            Status
          </a>
        </section>

        <section className="product-footer-col">
          <h4>Contact</h4>
          <a href="mailto:support@pondbridge.co">support@pondbridge.co</a>
        </section>
      </div>

      <div className="product-footer-bottom">
        <p>© {year} PondBridge. All rights reserved.</p>
      </div>
    </footer>
  );
}
