// One labelled number input with its unit; shared by the mix form and the experiment form.
export default function Field({ label, unit, ...input }) {
  return (
    <label className="field">
      <span className="name">{label}</span>
      <span className="control">
        <input type="number" step="any" {...input} />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}
