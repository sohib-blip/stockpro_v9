export default function RolesPage() {

  return (
    <div className="space-y-6">

      <h1 className="text-xl font-semibold">
        Roles
      </h1>

      <div className="card-glow p-6">

        <table className="w-full text-sm">

          <thead className="text-slate-400">
            <tr>
              <th className="text-left">Role</th>
              <th className="text-left">Permissions</th>
            </tr>
          </thead>

          <tbody>

            <tr className="border-t border-slate-800">
              <td className="py-2">admin</td>
              <td>Full access</td>
            </tr>

            <tr className="border-t border-slate-800">
              <td className="py-2">warehouse</td>
              <td>Inbound, Outbound, Transfer</td>
            </tr>

            <tr className="border-t border-slate-800">
              <td className="py-2">viewer</td>
              <td>Read only</td>
            </tr>

          </tbody>

        </table>

      </div>

    </div>
  );
}