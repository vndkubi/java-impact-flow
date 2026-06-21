package example;

class AdminUserResourceTest {
  void coversAdminUserApi() {
    AdminUserResource resource = new AdminUserResource();
    resource.findUser("42");
    resource.createUser(new UserDto("42"));
  }
}
