// An API 4 project data shape: pure functions over the datasets, as the
// Workday data shape is. The check runs an export and an import through it
// in a real sandboxed renderer.

export async function exportProjects(projects) {
  return {
    datasets: [
      {
        id: "projects",
        rows: projects.map((project) => ({
          project: project.name,
          hours: project.tasks.length,
        })),
      },
    ],
  };
}

export async function importProjects(datasets) {
  return {
    projects: datasets[0].rows.map((row) => ({
      name: row.project,
      color: "#123456",
      status: "active",
      tasks: [],
    })),
  };
}
