export default function Footer() {
  return (
    <footer className="fixed bottom-0 left-0 right-0 py-3 text-center text-sm text-sp-white bg-sp-very-dark-blue/90 backdrop-blur-sm border-t border-sp-dark-blue/50 z-50">
      <p>© {new Date().getFullYear()} Chris Talbot. All rights reserved.</p>
    </footer>
  );
} 