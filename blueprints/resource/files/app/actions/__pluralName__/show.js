import ApplicationAction from '../application';

export default class Show<%= className %> extends ApplicationAction {

  async respond(params) {
    let <%= className %> = this.modelFor('<%= name %>');
    return <%= className %>.find(params.id);
  }

}
