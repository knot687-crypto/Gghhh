// Minimal Luau host for tests: runs a script with the standard libraries plus
// loadfile(path) -> function (compiled from source) and readfile(path) -> string.
#include "lua.h"
#include "lualib.h"
#include "luacode.h"
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>
#include <string>

static bool readAll(const char* path, std::string& out) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::stringstream ss;
  ss << f.rdbuf();
  out = ss.str();
  return true;
}

static int load(lua_State* L, const char* path) {
  std::string src;
  if (!readAll(path, src)) {
    lua_pushfstring(L, "cannot open %s", path);
    return 1;
  }
  size_t size = 0;
  char* bc = luau_compile(src.data(), src.size(), nullptr, &size);
  std::string chunk = std::string("@") + path;
  int r = luau_load(L, chunk.c_str(), bc, size, 0);
  free(bc);
  return r;
}

static int l_loadfile(lua_State* L) {
  const char* path = luaL_checkstring(L, 1);
  if (load(L, path) != 0) lua_error(L);
  return 1;
}

static int l_readfile(lua_State* L) {
  std::string s;
  if (!readAll(luaL_checkstring(L, 1), s)) {
    lua_pushnil(L);
    return 1;
  }
  lua_pushlstring(L, s.data(), s.size());
  return 1;
}

static int l_clock(lua_State* L) {
  lua_pushnumber(L, lua_clock());
  return 1;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: luaurun script.luau [args]\n");
    return 2;
  }
  lua_State* L = luaL_newstate();
  luaL_openlibs(L);
  lua_pushcfunction(L, l_loadfile, "loadfile");
  lua_setglobal(L, "loadfile");
  lua_pushcfunction(L, l_readfile, "readfile");
  lua_setglobal(L, "readfile");
  lua_pushcfunction(L, l_clock, "hostclock");
  lua_setglobal(L, "hostclock");
  lua_createtable(L, argc, 0);
  for (int i = 0; i < argc; i++) {
    lua_pushstring(L, argv[i]);
    lua_rawseti(L, -2, i);
  }
  lua_setglobal(L, "arg");
  if (load(L, argv[1]) != 0) {
    fprintf(stderr, "%s\n", lua_tostring(L, -1));
    return 1;
  }
  if (lua_pcall(L, 0, 0, 0) != 0) {
    fprintf(stderr, "error: %s\n", lua_tostring(L, -1));
    return 1;
  }
  lua_close(L);
  return 0;
}
