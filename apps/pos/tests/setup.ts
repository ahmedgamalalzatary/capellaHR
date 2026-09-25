// jsdom leaves a few window APIs as throwing stubs (scrollTo, print), so any
// component that uses them floods the test output with "Not implemented" stack
// traces. Replace them with inert stand-ins so the tests stay readable.

window.scrollTo = () => undefined;
window.print = () => undefined;
