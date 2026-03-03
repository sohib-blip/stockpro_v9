export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <div className="min-h-screen flex justify-center">
          <div className="w-full max-w-7xl px-6">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}