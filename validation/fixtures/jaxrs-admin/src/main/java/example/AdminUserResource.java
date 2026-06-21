package example;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;

@Path("/admin/users")
class AdminUserResource {
  private final AdminUserService service = new AdminUserService();

  @GET
  @Path("/{id}")
  UserDto findUser(@PathParam("id") String id) {
    return service.findUser(id);
  }

  @POST
  UserDto createUser(UserDto dto) {
    return service.createUser(dto);
  }
}
