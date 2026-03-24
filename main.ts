import { produce } from 'immer';

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

class TodoList {
  todos: Todo[] = [];

  addTodo(text: string) {
    this.todos = produce(this.todos, (draft) => {
      draft.push({
        id: Date.now(),
        text,
        completed: false,
      });
    });
  }

  toggleTodo(id: number) {
    this.todos = produce(this.todos, (draft) => {
      const todo = draft.find((t) => t.id === id);
      if (todo) {
        todo.completed = !todo.completed;
      }
    });
  }

  removeTodo(id: number) {
    this.todos = produce(this.todos, (draft) => {
      const index = draft.findIndex((t) => t.id === id);
      if (index !== -1) {
        draft.splice(index, 1);
      }
    });
  }
}

const myTodos = new TodoList();
myTodos.addTodo('Learn Immer');
console.log('Todos:', myTodos.todos);

const firstId = myTodos.todos[0].id;
myTodos.toggleTodo(firstId);
console.log('After toggle:', myTodos.todos);
