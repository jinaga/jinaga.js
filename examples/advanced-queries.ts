/**
 * Advanced Query Examples
 * 
 * This file demonstrates complex query patterns, projections,
 * and advanced Jinaga.js features.
 */

import { JinagaBrowser } from "jinaga";

// Extended data model for complex examples
interface User {
  type: "User";
  publicKey: string;
}

interface UserName {
  type: "UserName";
  user: User;
  value: string;
  createdAt: string;
}

interface Company {
  type: "Company";
  creator: User;
  name: string;
}

interface Office {
  type: "Office";
  company: Company;
  name: string;
  address: string;
}

interface Employee {
  type: "Employee";
  office: Office;
  user: User;
  role: string;
  hiredAt: string;
}

interface Project {
  type: "Project";
  company: Company;
  name: string;
  description: string;
  createdAt: string;
}

interface Task {
  type: "Task";
  project: Project;
  assignedTo: Employee;
  title: string;
  description: string;
  status: "todo" | "in-progress" | "done";
  createdAt: string;
}

interface TaskComment {
  type: "TaskComment";
  task: Task;
  author: Employee;
  text: string;
  createdAt: string;
}

const j = JinagaBrowser.create({
  httpEndpoint: "http://localhost:8080/jinaga"
});

// Complex projection example
async function complexProjectionExample() {
  const company = await j.fact({
    type: "Company",
    creator: await j.fact({
      type: "User",
      publicKey: "creator-key"
    }),
    name: "Acme Corp"
  });

  // Find all employees with their details
  const employeesWithDetails = j.for(Company).match(company =>
    company.successors(Office, office => office.company)
      .select(office => ({
        office: office,
        employees: office.successors(Employee, employee => employee.office)
          .select(employee => ({
            employee: employee,
            user: employee.user,
            names: employee.user.successors(UserName, name => name.user)
              .select(name => name.value)
          }))
      }))
  );

  const result = await j.query(employeesWithDetails, company);
  console.log("Employees with details:", result);
}

// Multi-level navigation example
async function multiLevelNavigationExample() {
  const company = await j.fact({
    type: "Company",
    creator: await j.fact({
      type: "User",
      publicKey: "creator-key"
    }),
    name: "Acme Corp"
  });

  // Find all tasks across all projects with full context
  const allTasksWithContext = j.for(Company).match(company =>
    company.successors(Project, project => project.company)
      .select(project => ({
        project: project,
        tasks: project.successors(Task, task => task.project)
          .select(task => ({
            task: task,
            assignedTo: task.assignedTo,
            assignedUser: task.assignedTo.user,
            assignedUserNames: task.assignedTo.user.successors(UserName, name => name.user)
              .select(name => name.value),
            comments: task.successors(TaskComment, comment => comment.task)
              .select(comment => ({
                comment: comment,
                author: comment.author,
                authorUser: comment.author.user,
                authorNames: comment.author.user.successors(UserName, name => name.user)
                  .select(name => name.value)
              }))
          }))
      }))
  );

  const result = await j.query(allTasksWithContext, company);
  console.log("All tasks with context:", result);
}

// Predecessor navigation example
async function predecessorNavigationExample() {
  const task = await j.fact({
    type: "Task",
    project: await j.fact({
      type: "Project",
      company: await j.fact({
        type: "Company",
        creator: await j.fact({
          type: "User",
          publicKey: "creator-key"
        }),
        name: "Acme Corp"
      }),
      name: "Website Redesign",
      description: "Redesign the company website",
      createdAt: new Date().toISOString()
    }),
    assignedTo: await j.fact({
      type: "Employee",
      office: await j.fact({
        type: "Office",
        company: await j.fact({
          type: "Company",
          creator: await j.fact({
            type: "User",
            publicKey: "creator-key"
          }),
          name: "Acme Corp"
        }),
        name: "Main Office",
        address: "123 Main St"
      }),
      user: await j.fact({
        type: "User",
        publicKey: "employee-key"
      }),
      role: "Developer",
      hiredAt: new Date().toISOString()
    }),
    title: "Update homepage",
    description: "Update the homepage design",
    status: "in-progress",
    createdAt: new Date().toISOString()
  });

  // Navigate from task back to company through predecessors
  const taskToCompany = j.for(Task).match(task =>
    task.project.company.predecessor()
  );

  const company = await j.query(taskToCompany, task);
  console.log("Company from task:", company);
}

// Existential conditions example
async function existentialConditionsExample() {
  const company = await j.fact({
    type: "Company",
    creator: await j.fact({
      type: "User",
      publicKey: "creator-key"
    }),
    name: "Acme Corp"
  });

  // Find projects that have tasks (existential condition)
  const projectsWithTasks = j.for(Company).match(company =>
    company.successors(Project, project => project.company)
      .exists(project => project.successors(Task, task => task.project))
  );

  const result = await j.query(projectsWithTasks, company);
  console.log("Projects with tasks:", result);
}

// Chained queries example
async function chainedQueriesExample() {
  const user = await j.fact({
    type: "User",
    publicKey: "user-key"
  });

  // Find all tasks assigned to a user through their employee record
  const userTasks = j.for(User).match(user =>
    user.successors(Employee, employee => employee.user)
      .select(employee => ({
        employee: employee,
        tasks: employee.successors(Task, task => task.assignedTo)
          .select(task => ({
            task: task,
            project: task.project,
            company: task.project.company
          }))
      }))
  );

  const result = await j.query(userTasks, user);
  console.log("User tasks:", result);
}

// Performance optimization example
async function performanceOptimizationExample() {
  const company = await j.fact({
    type: "Company",
    creator: await j.fact({
      type: "User",
      publicKey: "creator-key"
    }),
    name: "Acme Corp"
  });

  // Use selectMany for flat collections when appropriate
  const allTaskTitles = j.for(Company).match(company =>
    company.successors(Project, project => project.company)
      .selectMany(project => 
        project.successors(Task, task => task.project)
          .select(task => task.title)
      )
  );

  const titles = await j.query(allTaskTitles, company);
  console.log("All task titles:", titles);
}

// Run all examples
async function runAdvancedExamples() {
  try {
    await complexProjectionExample();
    await multiLevelNavigationExample();
    await predecessorNavigationExample();
    await existentialConditionsExample();
    await chainedQueriesExample();
    await performanceOptimizationExample();
  } catch (error) {
    console.error("Error running advanced examples:", error);
  }
}

export {
  complexProjectionExample,
  multiLevelNavigationExample,
  predecessorNavigationExample,
  existentialConditionsExample,
  chainedQueriesExample,
  performanceOptimizationExample,
  runAdvancedExamples
};

if (require.main === module) {
  runAdvancedExamples();
}