package example;

class AdminUserService {
  UserDto findUser(String id) {
    return new UserDto(id);
  }

  UserDto createUser(UserDto dto) {
    return dto;
  }
}
