export default function SettingsPage() {
  return (
    <div className="space-y-6">

      <h1 className="text-xl font-semibold">
        Settings
      </h1>

      <div className="card-glow p-6 space-y-4">

        <a
          href="/settings/admin"
          className="block text-indigo-400 hover:underline"
        >
          Admin
        </a>

        <a
          href="/settings/roles"
          className="block text-indigo-400 hover:underline"
        >
          Roles
        </a>

      </div>

    </div>
  );
}